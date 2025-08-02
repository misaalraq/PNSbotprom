const { JsonRpcProvider, Wallet, Contract } = require("ethers");
const crypto = require("crypto");
const fs = require("fs");
const { EthersWallet } = require('ethersjs3-wallet');
const config = require("./config.js");




// ====== CẤU HÌNH ======
const RPC_URL = config.RPC_URL;
const CONTROLLER_ADDRESS = config.CONTROLLER_ADDRESS;
const DURATION = config.DURATION;
const RESOLVER = config.RESOLVER;
const wallet = new EthersWallet();
const DATA = config.DATA;
const REVERSE_RECORD = config.REVERSE_RECORD;
const OWNER_CONTROLLED_FUSES = config.OWNER_CONTROLLED_FUSES;
const REG_PER_KEY = config.REG_PER_KEY;
const MAX_CONCURRENCY = config.MAX_CONCURRENCY;

// ====== ABI RÚT GỌN (chỉ cần các hàm cần thiết) ======
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
      console.log(chalk.cyan(`[Ví số ${index+1} | Lần ${regIndex}] Wallet: ${OWNER}, Name: ${NAME}.phrs`));

      // 1. Tạo commitment
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
      console.log(chalk.blue(`[Ví số ${index+1} | Lần ${regIndex}] Commitment:`, commitment));

      // 2. Gửi commit
      let tx = await controller.commit(commitment);
      await tx.wait();
      console.log(chalk.green(`[Ví số ${index+1} | Lần ${regIndex}] Commitment sent!`));

      // 3. Đợi minCommitmentAge (thường vài phút, kiểm tra trên contract)
      console.log(chalk.yellow(`[Ví số ${index+1} | Lần ${regIndex}] Chờ minCommitmentAge 60s...`));
      await new Promise(r => setTimeout(r, 60000)); // 60 giây

      // 4. Tính giá
      const price = await controller.rentPrice(NAME, DURATION);
      const value = price.base + price.premium;
      console.log(chalk.magenta(`[Ví số ${index+1} | Lần ${regIndex}] Price:`, (Number(value) / 1e18).toString(), "ETH"));

      // 5. Đăng ký
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
      console.log(chalk.green(`[Ví số ${index+1} | Lần ${regIndex}] Đăng ký thành công!`));
      break; // Thành công thì thoát vòng lặp
    } catch (err) {
      // Bất cứ lỗi nào cũng nghỉ 60s rồi thử lại, tối đa 5 lần
      retry++;
      let msg = '';
      if (err && err.error && err.error.message) {
        msg = err.error.message;
        if (msg.length > 120) msg = msg.slice(0, 120) + '...';
        if (err.error.code) msg += ` (code: ${err.error.code})`;
      } else if (err && err.message) {
        msg = err.message;
        if (msg.length > 120) msg = msg.slice(0, 120) + '...';
        if (err.code) msg += ` (code: ${err.code})`;
      } else {
        msg = 'Lỗi không xác định!';
      }
      if (retry < MAX_RETRY) {
        console.log(chalk.yellow(`[Ví số ${index+1} | Lần ${regIndex}] Gặp lỗi: ${msg} - nghỉ 60s rồi thử lại lần ${retry}/${MAX_RETRY}...`));
        await new Promise(r => setTimeout(r, 60000));
        continue;
      } else {
        console.error(chalk.red(`[Ví số ${index+1} | Lần ${regIndex}] Lỗi sau ${MAX_RETRY} lần thử: ${msg}`));
        break;
      }
    }
  }
}

async function main() {
  const pLimit = (await import('p-limit')).default;
  const chalk = (await import('chalk')).default;
  // Đọc danh sách private key
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
      }
    }));
  });

  await Promise.all(tasks);
  console.log(chalk.green("Tất cả các tác vụ đã hoàn thành!"));
}

async function mainWrapper() {
  while (true) {
    try {
      await main();
      break; // Nếu main chạy xong không lỗi thì thoát
    } catch (err) {
      console.error('Lỗi nghiêm trọng ngoài main:', err && err.message ? err.message : err);
      console.log('Nghỉ 60s rồi thử lại toàn bộ...');
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

// Bắt lỗi toàn cục để script không bị dừng
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason && reason.message ? reason.message : reason);
  console.log('Nghỉ 60s rồi thử lại toàn bộ...');
  setTimeout(() => {
    mainWrapper();
  }, 60000);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.message ? err.message : err);
  console.log('Nghỉ 60s rồi thử lại toàn bộ...');
  setTimeout(() => {
    mainWrapper();
  }, 60000);
});

mainWrapper();
