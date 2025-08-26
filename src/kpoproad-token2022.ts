import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  getAccount,
} from '@solana/spl-token';

// ---------- Utils ----------
function loadKeypairFromPath(p: string): Keypair {
  const raw = fs.readFileSync(p, 'utf-8').trim();

  try {
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    const bytes = bs58.decode(raw);
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
}

async function airdropIfNeeded(conn: Connection, pubkey: PublicKey, minSol = 0.2) {
  const bal = await conn.getBalance(pubkey);
  if (bal < minSol * LAMPORTS_PER_SOL) {
    const sig = await conn.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    const newBal = await conn.getBalance(pubkey);
    console.log(`🔹 Airdrop. Balance: ${(newBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }
}

function envOr<T = string>(name: string, fallback: T): T {
  return (process.env[name] as unknown as T) ?? fallback;
}

// ---------- Main ----------
async function main() {
  const rpcUrl = envOr('RPC_URL', clusterApiUrl('devnet'));
  const payerPath = envOr(
    'PAYER_KEYPAIR_PATH',
    path.join(process.env.HOME || '.', '.config/solana/id.json')
  );
  const decimals = Number(envOr('DECIMALS', '9'));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    throw new Error('DECIMALS phải là số nguyên 0..9');
  }
  const mintTokens = BigInt(envOr('MINT_AMOUNT', '1_000_000_000'));
  const amount = mintTokens * 10n ** BigInt(decimals);

  console.log('RPC:', rpcUrl);
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const payer = loadKeypairFromPath(payerPath);
  console.log('Payer:', payer.publicKey.toBase58());

  if (rpcUrl.includes('devnet')) {
    await airdropIfNeeded(connection, payer.publicKey);
  }

  const mintAuthority = payer.publicKey;
  const freezeAuthority = payer.publicKey;

  const mintPubkey = await createMint(
    connection,
    payer,                      // payer
    mintAuthority,              // mintAuthority
    freezeAuthority,            // freezeAuthority
    decimals,                   // decimals
    undefined,                  // mintKeypair (auto)
    undefined,                  // confirm options
    TOKEN_2022_PROGRAM_ID       //  Token-2022 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
  );

  console.log('Token-2022 Mint:', mintPubkey.toBase58());

  // ====== Create/Receive ATA cho payer (Token-2022) ======
  const payerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintPubkey,
    payer.publicKey,
    true,                        // allowOwnerOffCurve
    'confirmed',
    undefined,                   // confirm options
    TOKEN_2022_PROGRAM_ID,       // Token-2022 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
    ASSOCIATED_TOKEN_PROGRAM_ID  // ATA Program
  );

  console.log('🔗 Payer ATA:', payerAta.address.toBase58());

  // ====== Mint ======
  const sig = await mintTo(
    connection,
    payer,
    mintPubkey,
    payerAta.address,
    payer,        // authority
    amount,       // bigint
    [],           // multiSigners
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID
  );

  console.log('Minted', mintTokens.toString(), 'token(s) ->', payerAta.address.toBase58());
  console.log('Tx:', sig);

  // ====== Check mint & Amount ATA ======
  const mintInfo = await getMint(connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const ataInfo  = await getAccount(connection, payerAta.address, 'confirmed', TOKEN_2022_PROGRAM_ID);

  console.log('Mint supply (raw):', mintInfo.supply.toString());
  console.log('Decimals:', mintInfo.decimals);
  console.log('ATA balance (raw):', ataInfo.amount.toString());

  console.log('\nDONE. Mint:', mintPubkey.toBase58());
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
