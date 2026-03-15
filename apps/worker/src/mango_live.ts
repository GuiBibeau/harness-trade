import { AnchorProvider, type Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { USDC_MINT } from "./defaults";
import { signTransactionWithPrivyById } from "./privy";
import type { Env } from "./types";

const MANGO_MAINNET_GROUP = new PublicKey(
  "78b8f4cGCwmZ9ysPFMWLaLTkkaYnUjwMJYStWe5RTSSX",
);
const MANGO_MAINNET_PROGRAM = new PublicKey(
  "4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg",
);
const USDC_DECIMALS = 6;

type MangoAccountLike = {
  publicKey: PublicKey;
  accountNum: number;
  beingLiquidated: boolean;
  serum3Active(): unknown[];
  perpActive(): unknown[];
  tokensActive(): Array<{ tokenIndex: number }>;
  getTokenBalanceUi(bank: { tokenIndex: number }): number;
};

type MangoGroupLike = {
  getFirstBankByMint(mint: PublicKey): { tokenIndex: number };
};

type MangoClientLike = {
  getGroup(groupPk: PublicKey): Promise<MangoGroupLike>;
  getMangoAccountsForOwner(
    group: MangoGroupLike,
    ownerPk: PublicKey,
  ): Promise<MangoAccountLike[]>;
  createMangoAccount(
    group: MangoGroupLike,
    accountNumber?: number,
    name?: string,
  ): Promise<{ signature: string }>;
  getMangoAccount(accountPk: PublicKey): Promise<MangoAccountLike>;
  tokenDeposit(
    group: MangoGroupLike,
    account: MangoAccountLike,
    mintPk: PublicKey,
    amount: number,
    reduceOnly?: boolean,
  ): Promise<{ signature: string }>;
  tokenWithdraw(
    group: MangoGroupLike,
    account: MangoAccountLike,
    mintPk: PublicKey,
    amount: number,
    allowBorrow: boolean,
  ): Promise<{ signature: string }>;
};

type MangoRuntimeModule = {
  MangoClient: {
    connect(
      provider: AnchorProvider,
      cluster: "mainnet-beta",
      programId: PublicKey,
    ): MangoClientLike;
  };
};

let mangoRuntimeModulePromise: Promise<MangoRuntimeModule> | null = null;

async function loadMangoRuntimeModule(): Promise<MangoRuntimeModule> {
  mangoRuntimeModulePromise ??= import(
    "@blockworks-foundation/mango-v4/dist/cjs/src/index.js"
  ) as Promise<MangoRuntimeModule>;
  return await mangoRuntimeModulePromise;
}

export type MangoLiveAccountSnapshot = {
  accountAddress: string;
  accountNumber: number;
  beingLiquidated: boolean;
  tokenBalanceUsdcAtomic: string;
  tokenBalanceUsdcUi: number;
  activeTokenPositionCount: number;
  activeSerum3OrderCount: number;
  activePerpPositionCount: number;
};

export type MangoLiveRoundTripResult = {
  accountAddress: string;
  createdAccount: boolean;
  createSignature: string | null;
  depositSignature: string;
  withdrawSignature: string;
  depositAmountAtomic: string;
  before: MangoLiveAccountSnapshot;
  afterDeposit: MangoLiveAccountSnapshot;
  afterWithdraw: MangoLiveAccountSnapshot;
};

type MangoLiveContext = {
  client: MangoClientLike;
  group: MangoGroupLike;
  ownerPublicKey: PublicKey;
};

function isVersionedTransaction(
  tx: Transaction | VersionedTransaction,
): tx is VersionedTransaction {
  return "version" in tx;
}

function decodeSignedTransaction<T extends Transaction | VersionedTransaction>(
  original: T,
  signedTransactionBase64: string,
): T {
  const wire = Uint8Array.from(Buffer.from(signedTransactionBase64, "base64"));
  if (isVersionedTransaction(original)) {
    return VersionedTransaction.deserialize(wire) as T;
  }
  return Transaction.from(wire) as T;
}

function uiToAtomic(uiAmount: number, decimals: number): string {
  const scaled = Math.round(uiAmount * 10 ** decimals);
  return Math.max(0, scaled).toString();
}

function atomicToUi(amountAtomic: string, decimals: number): number {
  const parsed = Number(amountAtomic);
  if (!Number.isFinite(parsed)) {
    throw new Error("mango-live-atomic-invalid");
  }
  return parsed / 10 ** decimals;
}

function selectSafeCanaryAccount(
  group: MangoGroupLike,
  accounts: MangoAccountLike[],
): MangoAccountLike | null {
  const usdcBank = group.getFirstBankByMint(new PublicKey(USDC_MINT));
  for (const account of accounts) {
    if (account.beingLiquidated) continue;
    if (account.serum3Active().length > 0) continue;
    if (account.perpActive().length > 0) continue;
    const unsafeTokenPosition = account.tokensActive().some((position) => {
      if (position.tokenIndex !== usdcBank.tokenIndex) {
        return true;
      }
      return account.getTokenBalanceUi(usdcBank) < 0;
    });
    if (unsafeTokenPosition) continue;
    return account;
  }
  return null;
}

function buildSnapshot(
  group: MangoGroupLike,
  account: MangoAccountLike,
): MangoLiveAccountSnapshot {
  const usdcBank = group.getFirstBankByMint(new PublicKey(USDC_MINT));
  const tokenBalanceUsdcUi = account.getTokenBalanceUi(usdcBank);
  return {
    accountAddress: account.publicKey.toBase58(),
    accountNumber: account.accountNum,
    beingLiquidated: account.beingLiquidated,
    tokenBalanceUsdcAtomic: uiToAtomic(tokenBalanceUsdcUi, USDC_DECIMALS),
    tokenBalanceUsdcUi,
    activeTokenPositionCount: account.tokensActive().length,
    activeSerum3OrderCount: account.serum3Active().length,
    activePerpPositionCount: account.perpActive().length,
  };
}

async function createPrivyWallet(input: {
  env: Env;
  walletId: string;
  walletPublicKey: PublicKey;
}): Promise<Wallet> {
  const wallet: Wallet = {
    publicKey: input.walletPublicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> {
      const wireBase64 = Buffer.from(tx.serialize()).toString("base64");
      const signedBase64 = await signTransactionWithPrivyById(
        input.env,
        input.walletId,
        wireBase64,
      );
      return decodeSignedTransaction(tx, signedBase64);
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> {
      return await Promise.all(txs.map((tx) => wallet.signTransaction(tx)));
    },
  };
  return wallet;
}

async function connectMangoLive(input: {
  env: Env;
  rpcEndpoint: string;
  walletId: string;
  walletAddress: string;
}): Promise<MangoLiveContext> {
  const runtime = await loadMangoRuntimeModule();
  const ownerPublicKey = new PublicKey(input.walletAddress);
  const wallet = await createPrivyWallet({
    env: input.env,
    walletId: input.walletId,
    walletPublicKey: ownerPublicKey,
  });
  const connection = new Connection(input.rpcEndpoint, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const client = runtime.MangoClient.connect(
    provider,
    "mainnet-beta",
    MANGO_MAINNET_PROGRAM,
  );
  const group = await client.getGroup(MANGO_MAINNET_GROUP);
  return {
    client,
    group,
    ownerPublicKey,
  };
}

async function waitForOwnerCanaryAccount(input: {
  client: MangoClientLike;
  group: MangoGroupLike;
  ownerPublicKey: PublicKey;
  knownAccounts: Set<string>;
}): Promise<MangoAccountLike> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const accounts = await input.client.getMangoAccountsForOwner(
      input.group,
      input.ownerPublicKey,
    );
    const created =
      accounts.find(
        (account) =>
          !input.knownAccounts.has(account.publicKey.toBase58()) &&
          selectSafeCanaryAccount(input.group, [account]),
      ) ?? selectSafeCanaryAccount(input.group, accounts);
    if (created) return created;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("mango-live-account-create-not-observed");
}

export async function runMangoLiveUsdcRoundTrip(input: {
  env: Env;
  rpcEndpoint: string;
  walletId: string;
  walletAddress: string;
  depositAmountAtomic?: string;
}): Promise<MangoLiveRoundTripResult> {
  const depositAmountAtomic = String(
    input.depositAmountAtomic ?? "1000000",
  ).trim();
  if (!/^[1-9][0-9]*$/.test(depositAmountAtomic)) {
    throw new Error("mango-live-deposit-amount-invalid");
  }

  const depositAmountUi = atomicToUi(depositAmountAtomic, USDC_DECIMALS);
  const { client, group, ownerPublicKey } = await connectMangoLive(input);
  const existingAccounts = await client.getMangoAccountsForOwner(
    group,
    ownerPublicKey,
  );
  const knownAccounts = new Set(
    existingAccounts.map((account) => account.publicKey.toBase58()),
  );
  let account = selectSafeCanaryAccount(group, existingAccounts);
  let createSignature: string | null = null;

  if (!account) {
    const createResult = await client.createMangoAccount(
      group,
      undefined,
      "ralph_canary",
    );
    createSignature = createResult.signature;
    account = await waitForOwnerCanaryAccount({
      client,
      group,
      ownerPublicKey,
      knownAccounts,
    });
  }

  const before = buildSnapshot(group, account);
  const depositResult = await client.tokenDeposit(
    group,
    account,
    new PublicKey(USDC_MINT),
    depositAmountUi,
    false,
  );
  const accountAfterDeposit = await client.getMangoAccount(account.publicKey);
  const afterDeposit = buildSnapshot(group, accountAfterDeposit);
  if (
    BigInt(afterDeposit.tokenBalanceUsdcAtomic) <
    BigInt(before.tokenBalanceUsdcAtomic) + BigInt(depositAmountAtomic)
  ) {
    throw new Error("mango-live-deposit-not-observed");
  }

  const withdrawResult = await client.tokenWithdraw(
    group,
    accountAfterDeposit,
    new PublicKey(USDC_MINT),
    depositAmountUi,
    false,
  );
  const accountAfterWithdraw = await client.getMangoAccount(
    accountAfterDeposit.publicKey,
  );
  const afterWithdraw = buildSnapshot(group, accountAfterWithdraw);
  const expectedFinalAtomic = BigInt(before.tokenBalanceUsdcAtomic);
  const actualFinalAtomic = BigInt(afterWithdraw.tokenBalanceUsdcAtomic);
  const driftAtomic =
    actualFinalAtomic > expectedFinalAtomic
      ? actualFinalAtomic - expectedFinalAtomic
      : expectedFinalAtomic - actualFinalAtomic;
  if (driftAtomic > 10n) {
    throw new Error("mango-live-withdraw-not-reconciled");
  }

  return {
    accountAddress: account.publicKey.toBase58(),
    createdAccount: createSignature !== null,
    createSignature,
    depositSignature: depositResult.signature,
    withdrawSignature: withdrawResult.signature,
    depositAmountAtomic,
    before,
    afterDeposit,
    afterWithdraw,
  };
}
