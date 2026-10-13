import { ed25519 } from "@noble/curves/ed25519";

/**
 * Minimal reader/signer for the one legacy transaction the Mostro API builds. It keeps `@solana/web3.js` out of the
 * browser and, more importantly, lets the app check what it is about to sign.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

export function base58Encode(bytes: Uint8Array): string {
   const digits: number[] = [];
   for (const byte of bytes) {
      let carry = byte;
      for (let i = 0; i < digits.length; i++) {
         carry += digits[i]! << 8;
         digits[i] = carry % 58;
         carry = (carry / 58) | 0;
      }
      while (carry > 0) {
         digits.push(carry % 58);
         carry = (carry / 58) | 0;
      }
   }
   let out = "";
   for (const byte of bytes) {
      if (byte !== 0) break;
      out += "1";
   }
   for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!];
   return out;
}

export function base58Decode(text: string): Uint8Array {
   const bytes: number[] = [];
   for (const char of text) {
      const value = ALPHABET.indexOf(char);
      if (value < 0) throw new Error("Not a base58 string.");
      let carry = value;
      for (let i = 0; i < bytes.length; i++) {
         carry += bytes[i]! * 58;
         bytes[i] = carry & 0xff;
         carry >>= 8;
      }
      while (carry > 0) {
         bytes.push(carry & 0xff);
         carry >>= 8;
      }
   }
   for (const char of text) {
      if (char !== "1") break;
      bytes.push(0);
   }
   return Uint8Array.from(bytes.reverse());
}

export function base64ToBytes(text: string): Uint8Array {
   const binary = atob(text);
   const bytes = new Uint8Array(binary.length);
   for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
   return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
   let binary = "";
   for (const byte of bytes) binary += String.fromCharCode(byte);
   return btoa(binary);
}

function readShortVec(bytes: Uint8Array, offset: number): { value: number; next: number } {
   let value = 0;
   for (let shift = 0, i = offset; i < bytes.length && shift < 21; shift += 7, i++) {
      value |= (bytes[i]! & 0x7f) << shift;
      if ((bytes[i]! & 0x80) === 0) return { value, next: i + 1 };
   }
   throw new Error("Malformed transaction.");
}

export interface ParsedTransaction {
   signatureCount: number;
   /** The signed message (everything after the signatures). */
   message: Uint8Array;
   numRequiredSignatures: number;
   accountKeys: string[];
   programIds: string[];
}

/** Reads a serialized LEGACY transaction. Throws on anything else (versioned messages, truncated data). */
export function parseLegacyTransaction(raw: Uint8Array): ParsedTransaction {
   const sigs = readShortVec(raw, 0);
   const messageOffset = sigs.next + sigs.value * 64;
   if (messageOffset >= raw.length) throw new Error("Malformed transaction.");
   const message = raw.slice(messageOffset);
   if ((message[0]! & 0x80) !== 0) throw new Error("Unsupported transaction version.");
   const numRequiredSignatures = message[0]!;
   const keys = readShortVec(message, 3);
   let at = keys.next;
   const accountKeys: string[] = [];
   for (let i = 0; i < keys.value; i++, at += 32) accountKeys.push(base58Encode(message.slice(at, at + 32)));
   at += 32; // recent blockhash
   const count = readShortVec(message, at);
   at = count.next;
   const programIds: string[] = [];
   for (let i = 0; i < count.value; i++) {
      const programIndex = message[at++]!;
      const accounts = readShortVec(message, at);
      at = accounts.next + accounts.value;
      const data = readShortVec(message, at);
      at = data.next + data.value;
      const id = accountKeys[programIndex];
      if (!id) throw new Error("Malformed transaction.");
      programIds.push(id);
   }
   return { signatureCount: sigs.value, message, numRequiredSignatures, accountKeys, programIds };
}

export interface PrepareInput {
   transaction: string;
   buyerSignatureIndex: number;
   walletAddress: string;
   /** Programs the transaction may call besides the compute budget. Anything else is refused before the wallet signs. */
   allowedPrograms: string[];
}

/**
 * Checks the transaction the API sent: the buyer is the signer at the announced position, the transaction only calls
 * the compute budget program and the Mostro program, and the sponsor (the fee payer) has already signed.
 */
export function prepareForSigning(input: PrepareInput): { raw: Uint8Array; parsed: ParsedTransaction } {
   const raw = base64ToBytes(input.transaction);
   const parsed = parseLegacyTransaction(raw);
   if (parsed.numRequiredSignatures !== 2 || parsed.signatureCount !== 2 || input.buyerSignatureIndex !== 1)
      throw new Error("The purchase is not shaped as expected. Nothing was signed.");
   if (parsed.accountKeys[input.buyerSignatureIndex] !== input.walletAddress) throw new Error("The purchase is not for your wallet. Nothing was signed.");
   const allowed = new Set([COMPUTE_BUDGET_PROGRAM, ...input.allowedPrograms]);
   for (const id of parsed.programIds) if (!allowed.has(id)) throw new Error("The purchase contains an unexpected step. Nothing was signed.");
   if (raw.slice(1, 65).every((byte) => byte === 0)) throw new Error("The purchase was not prepared correctly. Nothing was signed.");
   return { raw, parsed };
}

/** Accepts a 64-byte ed25519 signature as bytes, hex (with or without 0x), base58 or base64. */
export function normalizeSignature(value: string | Uint8Array): Uint8Array {
   if (typeof value !== "string") {
      if (value.length !== 64) throw new Error("Unexpected signature length.");
      return value;
   }
   const text = value.trim();
   const hex = text.replace(/^0x/i, "");
   if (/^[0-9a-f]{128}$/i.test(hex)) return Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
   for (const decode of [base58Decode, base64ToBytes]) {
      try {
         const bytes = decode(text);
         if (bytes.length === 64) return bytes;
      } catch {
         // try the next encoding
      }
   }
   throw new Error("Unexpected signature format.");
}

/** True when `signature` is a valid ed25519 signature of `message` by `walletAddress`. */
export function verifySignature(signature: Uint8Array, message: Uint8Array, walletAddress: string): boolean {
   try {
      return ed25519.verify(signature, message, base58Decode(walletAddress));
   } catch {
      return false;
   }
}

/** Puts the buyer's signature into the transaction and returns the bytes to send. Refuses an invalid signature. */
export function attachBuyerSignature(raw: Uint8Array, parsed: ParsedTransaction, buyerSignatureIndex: number, signature: Uint8Array, walletAddress: string): Uint8Array {
   if (!verifySignature(signature, parsed.message, walletAddress)) throw new Error("The wallet returned a signature that does not match this purchase. Nothing was sent.");
   const signed = raw.slice();
   signed.set(signature, 1 + buyerSignatureIndex * 64);
   return signed;
}

/** The transaction id Solana shows: the first signature (the fee payer's, i.e. the sponsor's). */
export function transactionId(signed: Uint8Array): string {
   return base58Encode(signed.slice(1, 65));
}
