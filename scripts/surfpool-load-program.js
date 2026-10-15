#!/usr/bin/env node
// Loads a compiled program into a running surfpool fork without a chunked deploy: writes the
// upgradeable-loader `Program` and `ProgramData` accounts directly with `surfnet_setAccount`.
// Instant, and immune to the slot/blockhash churn that makes `solana program deploy` hang on a
// fork. Only for local testing; devnet still uses `anchor deploy` / `solana program deploy`.
//
//   node scripts/surfpool-load-program.js <program.so> <program-keypair.json> <upgrade-authority-keypair.json> [rpc]
const fs = require("fs");
const { Keypair, PublicKey } = require("@solana/web3.js");

const [, , soPath, programKeypairPath, authorityKeypairPath, rpc = "http://127.0.0.1:8899"] = process.argv;
if (!soPath || !programKeypairPath || !authorityKeypairPath) {
   console.error("usage: surfpool-load-program.js <program.so> <program-keypair.json> <authority-keypair.json> [rpc]");
   process.exit(2);
}

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const programId = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(programKeypairPath, "utf8")))).publicKey;
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(authorityKeypairPath, "utf8")))).publicKey;
const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER);
const elf = fs.readFileSync(soPath);

// UpgradeableLoaderState::Program { programdata_address }: u32 discriminant 2 + pubkey.
const programAccount = Buffer.concat([Buffer.from([2, 0, 0, 0]), programData.toBuffer()]);
// UpgradeableLoaderState::ProgramData { slot, upgrade_authority_address }: u32 discriminant 3 + u64 slot + Option<Pubkey> + elf.
const header = Buffer.alloc(4 + 8 + 1 + 32);
header.writeUInt32LE(3, 0);
header.writeBigUInt64LE(0n, 4);
header[12] = 1;
authority.toBuffer().copy(header, 13);
const programDataAccount = Buffer.concat([header, elf]);

const rentExempt = (bytes) => (128 + bytes) * 6960; // generous: above the 5,080 lamports/byte-year * 2 years rule

async function call(method, params) {
   const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
   const j = await res.json();
   if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
   return j.result;
}

(async () => {
   await call("surfnet_setAccount", [
      programData.toBase58(),
      { lamports: rentExempt(programDataAccount.length), data: programDataAccount.toString("hex"), owner: LOADER.toBase58(), executable: false, rentEpoch: 0 },
   ]);
   await call("surfnet_setAccount", [
      programId.toBase58(),
      { lamports: rentExempt(programAccount.length), data: programAccount.toString("hex"), owner: LOADER.toBase58(), executable: true, rentEpoch: 0 },
   ]);
   const info = await call("getAccountInfo", [programId.toBase58(), { encoding: "base64" }]);
   if (!info.value || !info.value.executable) throw new Error("program account not executable after load");
   console.log(`loaded ${programId.toBase58()} (${elf.length} bytes, program data ${programData.toBase58()}, upgrade authority ${authority.toBase58()})`);
})().catch((e) => {
   console.error(e.message);
   process.exit(1);
});
