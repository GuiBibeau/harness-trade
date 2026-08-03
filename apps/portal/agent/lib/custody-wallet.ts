import {
  PublicKey,
  SystemProgram,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  buildSignableTransaction,
  createSolanaConnection,
} from "../../src/lib/phoenix-trade";
import { getUserById } from "../../src/lib/server/privy";
import {
  AGENT_WALLET_RENT_RESERVE_LAMPORTS,
  clampWithdrawLamports,
  resolveOwnerWithdrawDestination,
} from "./custody-policy";
import { getServerWallet, signAndSendWithServerWallet } from "./server-wallet";

function rpcUrl(): string {
  return String(
    process.env.PUBLIC_SOLANA_RPC_URL ??
      process.env.SOLANA_RPC_URL ??
      "https://api.mainnet-beta.solana.com",
  ).trim();
}

export type CustodyWalletSnapshot = {
  agentWalletAddress: string;
  ownerSolanaWallet: string | null;
  custody: "eve-server";
  solBalanceLamports: number;
  solBalance: number;
  spendableLamports: number;
  rentReserveLamports: number;
  masterSecretConfigured: boolean;
};

export async function readCustodyWalletSnapshot(
  userId: string,
): Promise<CustodyWalletSnapshot> {
  const wallet = getServerWallet(userId);
  const owner = await getUserById(userId);
  const connection = createSolanaConnection(rpcUrl());
  const solBalanceLamports = await connection.getBalance(
    new PublicKey(wallet.address),
  );
  const spendableLamports = Math.max(
    0,
    solBalanceLamports - AGENT_WALLET_RENT_RESERVE_LAMPORTS,
  );
  return {
    agentWalletAddress: wallet.address,
    ownerSolanaWallet: owner?.solanaWallet ?? null,
    custody: "eve-server",
    solBalanceLamports,
    solBalance: solBalanceLamports / 1e9,
    spendableLamports,
    rentReserveLamports: AGENT_WALLET_RENT_RESERVE_LAMPORTS,
    masterSecretConfigured: true,
  };
}

/**
 * Evacuate SOL from the server-custody agent wallet to the Privy-linked
 * owner Solana wallet only. Destination is never taken from the client body.
 */
export async function withdrawAgentSolToOwner(input: {
  userId: string;
  lamports: number | "max";
}): Promise<{
  signature: string;
  lamports: number;
  destination: string;
  agentWalletAddress: string;
}> {
  const wallet = getServerWallet(input.userId);
  const owner = await getUserById(input.userId);
  const destination = resolveOwnerWithdrawDestination({
    ownerSolanaWallet: owner?.solanaWallet,
    agentWalletAddress: wallet.address,
  });
  if (!destination.ok) throw new Error(destination.error);

  const connection = createSolanaConnection(rpcUrl());
  const balanceLamports = await connection.getBalance(
    new PublicKey(wallet.address),
  );
  const clamped = clampWithdrawLamports({
    balanceLamports,
    requestedLamports: input.lamports,
  });
  if (!clamped.ok) throw new Error(clamped.error);

  // Defense in depth: only a SystemProgram transfer to the resolved owner.
  const instruction = SystemProgram.transfer({
    fromPubkey: new PublicKey(wallet.address),
    toPubkey: new PublicKey(destination.destination),
    lamports: clamped.lamports,
  });
  const { transaction } = await buildSignableTransaction(
    rpcUrl(),
    wallet.address,
    [instruction],
  );
  // Reject any bundled extra program — evacuate is transfer-only.
  assertTransferOnlyTransaction(transaction, wallet.address);

  const receipt = await signAndSendWithServerWallet({
    wallet,
    transaction,
    connection,
  });
  if (receipt.status !== "confirmed") {
    throw new Error(
      receipt.status === "unknown"
        ? `withdraw-outcome-unknown:${receipt.signature}`
        : `withdraw-rejected:${receipt.signature}`,
    );
  }
  return {
    signature: receipt.signature,
    lamports: clamped.lamports,
    destination: destination.destination,
    agentWalletAddress: wallet.address,
  };
}

function assertTransferOnlyTransaction(
  transaction: VersionedTransaction,
  feePayer: string,
): void {
  if (transaction.message.header.numRequiredSignatures !== 1) {
    throw new Error("withdraw-extra-signers-rejected");
  }
  if (transaction.message.staticAccountKeys[0]?.toBase58() !== feePayer) {
    throw new Error("withdraw-fee-payer-mismatch");
  }
  const compiled = transaction.message.compiledInstructions;
  if (compiled.length < 1) throw new Error("withdraw-empty-transaction");
  // Allow compute-budget prefix + exactly one SystemProgram transfer.
  const keys = transaction.message.staticAccountKeys;
  const systemId = SystemProgram.programId.toBase58();
  const computeBudgetId = "ComputeBudget111111111111111111111111111111";
  let transferCount = 0;
  for (const ix of compiled) {
    const programId = keys[ix.programIdIndex]?.toBase58();
    if (programId === computeBudgetId) continue;
    if (programId !== systemId) {
      throw new Error(`withdraw-program-rejected:${programId ?? "unknown"}`);
    }
    transferCount += 1;
  }
  if (transferCount !== 1) {
    throw new Error("withdraw-transfer-count-invalid");
  }
}
