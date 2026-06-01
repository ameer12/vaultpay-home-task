import { useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract
} from "wagmi";
import {
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  parseUnits,
  stringToBytes,
  zeroHash,
  type Address
} from "viem";
import { tokenAbi, vaultPayAbi } from "./abis";
import { LOCAL_CHAIN_ID, TOKEN_ADDRESS, TOKEN_SYMBOL, VAULTPAY_ADDRESS } from "./config";

const TX_GAS_LIMIT = 500_000n;

function isConfigured(address: string) {
  return address !== "0x0000000000000000000000000000000000000000";
}

function parseRecipientAddress(input: string): Address | null {
  const trimmed = input.trim();
  if (!isAddress(trimmed, { strict: false })) return null;
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

export default function App() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync, data: txHash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("10");
  const [expiryMinutes, setExpiryMinutes] = useState("30");
  const [memo, setMemo] = useState("");
  const [paymentId, setPaymentId] = useState("1");
  const [status, setStatus] = useState<string>("");

  const configured = isConfigured(TOKEN_ADDRESS) && isConfigured(VAULTPAY_ADDRESS);

  const amountInBaseUnits = useMemo(() => {
    try {
      return parseUnits(amount || "0", 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  const parsedRecipient = useMemo(() => parseRecipientAddress(recipient), [recipient]);

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && configured) }
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: tokenAbi,
    functionName: "allowance",
    args: address ? [address, VAULTPAY_ADDRESS] : undefined,
    query: { enabled: Boolean(address && configured) }
  });

  async function runTransaction(label: string, fn: () => Promise<`0x${string}`>) {
    try {
      setStatus(`${label}: waiting for wallet confirmation...`);
      const hash = await fn();
      setStatus(`${label}: submitted ${hash}`);
      await refetchBalance();
      await refetchAllowance();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function faucet() {
    await runTransaction("Faucet", () =>
      writeContractAsync({
        address: TOKEN_ADDRESS,
        abi: tokenAbi,
        functionName: "faucet",
        gas: TX_GAS_LIMIT
      })
    );
  }

  async function approve() {
    await runTransaction("Approve", () =>
      writeContractAsync({
        address: TOKEN_ADDRESS,
        abi: tokenAbi,
        functionName: "approve",
        args: [VAULTPAY_ADDRESS, amountInBaseUnits],
        gas: TX_GAS_LIMIT
      })
    );
  }

  async function createPayment() {
    const recipientAddress = parseRecipientAddress(recipient);
    if (!recipientAddress) {
      setStatus("Error: Recipient address is invalid.");
      return;
    }
    const minutes = Number(expiryMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setStatus("Expiry must be a positive number of minutes.");
      return;
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
    const memoHash = memo ? keccak256(stringToBytes(memo)) : zeroHash;

    await runTransaction("Create payment", () =>
      writeContractAsync({
        address: VAULTPAY_ADDRESS,
        abi: vaultPayAbi,
        functionName: "createPayment",
        args: [recipientAddress, amountInBaseUnits, deadline, memoHash],
        gas: TX_GAS_LIMIT
      })
    );
  }

  async function claimPayment() {
    await runTransaction("Claim payment", () =>
      writeContractAsync({
        address: VAULTPAY_ADDRESS,
        abi: vaultPayAbi,
        functionName: "claimPayment",
        args: [BigInt(paymentId || "0")],
        gas: TX_GAS_LIMIT
      })
    );
  }

  async function cancelPayment() {
    await runTransaction("Cancel payment", () =>
      writeContractAsync({
        address: VAULTPAY_ADDRESS,
        abi: vaultPayAbi,
        functionName: "cancelPayment",
        args: [BigInt(paymentId || "0")],
        gas: TX_GAS_LIMIT
      })
    );
  }

  const balanceDisplay =
    balance !== undefined ? `${formatUnits(balance, 18)} ${TOKEN_SYMBOL}` : "—";
  const allowanceDisplay =
    allowance !== undefined ? `${formatUnits(allowance, 18)} ${TOKEN_SYMBOL}` : "—";

  return (
    <main className="page">
      <header className="hero">
        <article className="prose prose-2xl prose-invert max-w-none">
          <span className="hero__badge">Local Hardhat · tUSD escrow</span>
          <h1 className="!mt-0 !mb-2">VaultPay</h1>
          <p className="lead !mt-0">
            Mint virtual tUSD, approve spending, and run escrowed payments on your local chain.
          </p>
        </article>
      </header>

      {!configured && (
        <div className="alert alert--warning">
          <p>
            Contract addresses are not configured. Update <code>frontend/src/config.ts</code>.
          </p>
        </div>
      )}

      {chainId !== LOCAL_CHAIN_ID && (
        <div className="alert alert--warning">
          <p>
            Current chain ID: {chainId}. Connect MetaMask to Hardhat (chain ID {LOCAL_CHAIN_ID}).
          </p>
        </div>
      )}

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">Wallet</h2>
        </div>

        {isConnected ? (
          <>
            <p className="address">{address}</p>
            <div className="stats">
              <div className="stat">
                <span className="stat__label">Balance</span>
                <span className="stat__value">{balanceDisplay}</span>
              </div>
              <div className="stat">
                <span className="stat__label">Allowance</span>
                <span className="stat__value">{allowanceDisplay}</span>
              </div>
            </div>
            <button className="btn btn--ghost" onClick={() => disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <div className="btn-row">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                className="btn btn--primary"
                disabled={isConnecting}
                onClick={() => connect({ connector })}
              >
                Connect {connector.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>1. Get virtual currency</h2>
          <button className="btn btn--primary" disabled={!isConnected || !configured} onClick={faucet}>
            Claim faucet tUSD
          </button>
        </section>

        <section className="card">
          <h2>2. Approve spending</h2>
          <input
            className="field__input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button className="btn btn--primary" disabled={!isConnected || !configured} onClick={approve}>
            Approve VaultPay
          </button>
        </section>
      </div>

      <section className="card">
        <h2>3. Create payment</h2>
        <input
          className="field__input"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Recipient address"
        />
        <input
          className="field__input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
        />
        <input
          className="field__input"
          value={expiryMinutes}
          onChange={(e) => setExpiryMinutes(e.target.value)}
          placeholder="Expiry minutes"
        />
        <input
          className="field__input"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Memo (optional)"
        />
        <button className="btn btn--primary" disabled={!isConnected || !configured} onClick={createPayment}>
          Create escrowed payment
        </button>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>4. Claim payment</h2>
          <input
            className="field__input"
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
          />
          <button className="btn btn--primary" disabled={!isConnected || !configured} onClick={claimPayment}>
            Claim payment
          </button>
        </section>

        <section className="card">
          <h2>5. Cancel payment</h2>
          <input
            className="field__input"
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
          />
          <button className="btn btn--secondary" disabled={!isConnected || !configured} onClick={cancelPayment}>
            Cancel payment
          </button>
        </section>
      </div>

      <section className="card status-panel">
        <h2>Transaction status</h2>
        <p className={`status-panel__body ${!status ? "is-empty" : ""}`}>{status || "No transaction yet."}</p>
        {txHash && <p>Last tx: {txHash}</p>}
        {receipt.isLoading && <p>Waiting for confirmation…</p>}
        {receipt.isSuccess && <p>Transaction confirmed.</p>}
      </section>
    </main>
  );
}