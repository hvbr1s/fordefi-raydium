// import { BN } from 'bn.js'
import { Transaction, VersionedTransaction } from '@solana/web3.js'
import axios from 'axios'
import { FordefiSolanaConfig, RaydiumSwapConfig } from '../raydium_swap'
import { API_URLS } from '@raydium-io/raydium-sdk-v2'
import * as web3 from '@solana/web3.js'
import * as jito from 'jito-ts'
import { getJitoTipAccount } from '../utils/get_jito_tip_account'
import { getPriorityFees } from '../utils/get_priority_fees'
import { PublicKey } from '@solana/web3.js'


const connection = new web3.Connection("https://api.mainnet-beta.solana.com")


async function createJitoInstructions(fordefiSolanaVaultAddress: string, jitoTip: number): Promise<web3.TransactionInstruction[]> {
    // Create Jito client instance
    const client = jito.searcher.searcherClient("frankfurt.mainnet.block-engine.jito.wtf")

    // Get Jito Tip Account
    const jitoTipAccount = await getJitoTipAccount(client)
    console.log(`Tip amount -> ${jitoTip}`)

    // Create and return Jito tip instruction
    return [
        web3.SystemProgram.transfer({
            fromPubkey: new web3.PublicKey(fordefiSolanaVaultAddress),
            toPubkey: jitoTipAccount,
            lamports: jitoTip,
        })
    ];
}

export async function swapWithRaydium(fordefiConfig: FordefiSolanaConfig, swapConfig: RaydiumSwapConfig){

    const fordefiVaultPubKey = new PublicKey(fordefiConfig.fordefiSolanaVaultAddress)
    const swapInput = swapConfig.swapAmount
    const inputTokenMint = new PublicKey(swapConfig.inputMint)
    console.debug("SwapResponse", swapConfig)

    const { data: swapResponse } = await axios.get(
        `${
          API_URLS.SWAP_HOST
        }/compute/swap-base-in?inputMint=${swapConfig.inputMint}&outputMint=${swapConfig.outputMint}&amount=${swapConfig.swapAmount}&slippageBps=${
            swapConfig.slippage * 100}&txVersion=${swapConfig.txVersion}`
      ) // Use the URL xxx/swap-base-in or xxx/swap-base-out to define the swap type. 
    console.debug("SwapResponse", swapResponse)

    const { data: swapTransactions } = await axios.post<{
        id: string
        version: string
        success: boolean
        data: { transaction: string }[]
      }>(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
        computeUnitPriceMicroLamports: String(await getPriorityFees()),
        swapResponse,
        txVersion: swapConfig.txVersion,
        wallet: fordefiVaultPubKey.toBase58(),
        wrapSol: swapConfig.isInputSol,
        unwrapSol: swapConfig.isOutputSol, // true means output mint receive sol, false means output mint received wsol
        inputAccount: swapConfig.isInputSol ? undefined : inputTokenMint?.toBase58(),
      })

      const isV0Tx = swapConfig.txVersion === "V0";
      const allTxBuf = swapTransactions.data.map((tx) => Buffer.from(tx.transaction, 'base64'))
      const allTransactions = allTxBuf.map((txBuf) =>
        isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
      )
    
      console.log(`total ${allTransactions.length} transactions`, swapTransactions)

    // Serialize the swap tx
    let serializedTxData;
    if (isV0Tx) {
        // For V0 transactions
        const versionedTx = allTransactions[0] as VersionedTransaction;
        serializedTxData = Buffer.from(
            versionedTx.message.serialize()
        ).toString('base64');
    } else {
        // For legacy transactions
        const legacyTx = allTransactions[0] as Transaction;
        serializedTxData = Buffer.from(
            legacyTx.serializeMessage()
        ).toString('base64');
    }

    // Create JSON
    const pushMode = swapConfig.useJito ? "manual" : "auto";
    const jsonBody = {

        "vault_id": fordefiConfig.vaultId, // Replace with your vault ID
        "signer_type": "api_signer",
        "sign_mode": "auto", // IMPORTANT
        "type": "solana_transaction",
        "details": {
            "type": "solana_serialized_transaction_message",
            "push_mode": pushMode, // IMPORTANT,
            "data": serializedTxData,  // For legacy transactions, use `serializedLegacyMessage`
            "chain": "solana_mainnet"
        },
        "wait_for_state": "signed" // only for create-and-wait
        
    };

    return jsonBody;
}
