const { JsonRpcProvider, Wallet, Contract } = require("ethers");
const crypto = require("crypto");
const fs = require("fs");
const config = require("./config.js");

// ====== KONFIGURASI ======
const RPC_URL = config.RPC_URL;
const CONTROLLER_ADDRESS = config.CONTROLLER_ADDRESS;
const DURATION = config.DURATION;
const RESOLVER = config.RESOLVER;
const DATA = config.DATA;
const REVERSE_RECORD = config.REVERSE_RECORD;
const OWNER_CONTROLLED_FUSES = config.OWNER_CONTROLLED_FUSES;
const REG_PER_KEY = config.REG_PER_KEY;
const MAX_CONCURRENCY = config.MAX_CONCURRENCY;

// ====== ABI yang diperlukan ======
const controllerAbi = [
  "function makeCommitment(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) public pure returns (bytes32)",
  "function commit(bytes32 commitment) public",
  "function rentPrice(string name, uint256 duration) public view returns (tuple(uint256 base, uint256 premium))",
  "function register(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) public payable"
];

function randomName(length = 9) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function registerDomain(PRIVATE_KEY, index, regIndex, chalk) {
  const MAX_RETRY = 5;
  let retry = 0;

  while (retry < MAX_RETRY) {
    try {
      const provider = new JsonRpcProvider(RPC_URL);
      const wallet = new Wallet(PRIVATE_KEY, provider);
      const controller = new Contract(CONTROLLER_ADDRESS, controllerAbi, wallet);
      const OWNER = wallet.address;
      const NAME = randomName();
      const SECRET = "0x" + crypto.randomBytes(32).toString("hex");

      console.log(chalk.cyan(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] Wallet: ${OWNER}, Nama: ${NAME}.phrs`));

      // 1. Buat commitment
      const commitment = await controller.makeCommitment(
        NAME,
        OWNER,
        DURATION,
        SECRET,
        RESOLVER,
        DATA,
        REVERSE_RECORD,
        OWNER_CONTROLLED_FUSES
      );
      console.log(chalk.blue(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] Commitment: ${commitment}`));

      // 2. Kirim commit
      let tx = await controller.commit(commitment);
      await tx.wait();
      console.log(chalk.green(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] Commitment berhasil dikirim!`));

      // 3. Tunggu minCommitmentAge (default 60 detik)
      console.log(chalk.yellow(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] Menunggu 60 detik sebelum melanjutkan...`));
      await delay(60000);

      // 4. Cek harga
      const price = await controller.rentPrice(NAME, DURATION);
      const value = price.base + price.premium;
      console.log(chalk.magenta(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] Harga: ${(Number(value) / 1e18).toString()} ETH`));

      // 5. Daftar domain
      tx = await controller.register(
        NAME,
        OWNER,
        DURATION,
        SECRET,
        RESOLVER,
        DATA,
        REVERSE_RECORD,
        OWNER_CONTROLLED_FUSES,
        { value }
      );
      await tx.wait();
      console.log(chalk.green(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] ✅ Pendaftaran domain berhasil!`));

      break;
    } catch (err) {
      retry++;
      let msg = err.message || 'Error tidak diketahui';
      if (msg.length > 120) msg = msg.slice(0, 120) + '...';

      if (retry < MAX_RETRY) {
        console.log(chalk.yellow(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] Gagal: ${msg} - coba lagi (${retry}/${MAX_RETRY}) setelah 60 detik...`));
        await delay(60000);
      } else {
        console.error(chalk.red(`[Wallet ${index + 1} | Pendaftaran ${regIndex}] ❌ Gagal setelah ${MAX_RETRY} percobaan: ${msg}`));
      }
    }
  }
}

async function main() {
  const pLimit = (await import('p-limit')).default;
  const chalk = (await import('chalk')).default;

  // Baca PK dari pk.txt
  const pkList = fs.readFileSync("pk.txt", "utf-8")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(x => x.length > 0);

  const limit = pLimit(MAX_CONCURRENCY);
  const tasks = [];

  pkList.forEach((pk, idx) => {
    tasks.push(limit(async () => {
      for (let i = 0; i < REG_PER_KEY; i++) {
        await registerDomain(pk, idx, i + 1, chalk);

        // Tambahkan jeda 5 detik sebelum pendaftaran domain berikutnya
        if (i < REG_PER_KEY - 1) {
          console.log(`⏳ Menunggu 5 detik sebelum pendaftaran domain berikutnya...`);
          await delay(5000);
        }
      }
    }));
  });

  await Promise.all(tasks);
  console.log(chalk.green("✅ Semua pendaftaran selesai!"));
}

main().catch(err => {
  console.error("❌ Error fatal:", err.message || err);
});
