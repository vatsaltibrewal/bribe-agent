import { Telegraf } from 'telegraf';
import {
    createPublicClient,
    createWalletClient,
    http,
    parseUnits,
    formatUnits,
    getAddress,
    isAddress, 
    defineChain, 
    Account,
    Address,
    Hex,
    PublicClient,
    WalletClient,
    Log, 
    TransactionReceipt, 
    Abi, 
    ContractFunctionExecutionError 
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mantleSepoliaTestnet } from 'viem/chains';
import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuration & Constants ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const EVM_RPC_URL = process.env.EVM_RPC_URL || 'https://rpc.sepolia.mantle.xyz';
var AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
const YIELD_AGGREGATOR_CONTRACT_ADDRESS = process.env.YIELD_AGGREGATOR_CONTRACT_ADDRESS as Address | undefined;
const BRIBE_COLLECTOR_CONTRACT_ADDRESS = process.env.BRIBE_COLLECTOR_CONTRACT_ADDRESS as Address | undefined;
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => id.trim()).filter(id => id);
const REBALANCE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BRIBE_APY_SCALE_FACTOR = 0.01; // Scale factor for APY boost calculation

const TARGET_CHAIN = mantleSepoliaTestnet;

// --- Token Registry (Mantle Sepolia) ---
// Note: On testnets, token addresses change often depending on the faucet used.
// These are common addresses, but you should verify them against your specific testnet deployment.
const tokenRegistry: Record<string, Address> = {
    "MNT": getAddress("0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000"), // Native MNT usually represented by a placeholder or wrapped logic
    "WMNT": getAddress("0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8"), // Standard WETH/WMNT on Mantle Sepolia
    "USDC": getAddress("0xDe33F39C168393e1858525b642647E3272444650"), // Example Testnet USDC
    "USDT": getAddress("0x5F8D4232367759bCe5d9488D3ade77C199896500")  // Example Testnet USDT
};

// --- ABI Definitions (unchanged) ---
const yieldAggregatorABI = [
	{
		"inputs": [{"internalType": "address","name": "initialOwner","type": "address"}],
		"stateMutability": "nonpayable","type": "constructor"
	},
	{
		"inputs": [{"internalType": "address","name": "owner","type": "address"}],
		"name": "OwnableInvalidOwner","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "account","type": "address"}],
		"name": "OwnableUnauthorizedAccount","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "token","type": "address"}],
		"name": "SafeERC20FailedOperation","type": "error"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "user","type": "address"},
			{"indexed": true,"internalType": "address","name": "token","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
		],
		"name": "Deposited","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "agent","type": "address"},
			{"indexed": true,"internalType": "string","name": "protocolId","type": "string"},
			{"indexed": true,"internalType": "address","name": "rewardToken","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
		],
		"name": "Harvested","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "previousOwner","type": "address"},
			{"indexed": true,"internalType": "address","name": "newOwner","type": "address"}
		],
		"name": "OwnershipTransferred","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "string","name": "protocolId","type": "string"},
			{"indexed": true,"internalType": "address","name": "protocolAddress","type": "address"}
		],
		"name": "ProtocolAdded","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "agent","type": "address"},
			{"indexed": false,"internalType": "string","name": "fromProtocolId","type": "string"},
			{"indexed": false,"internalType": "string","name": "toProtocolId","type": "string"},
			{"indexed": true,"internalType": "address","name": "token","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
		],
		"name": "Rebalanced","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "token","type": "address"},
			{"indexed": false,"internalType": "bool","name": "isAccepted","type": "bool"}
		],
		"name": "TokenAccepted","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "user","type": "address"},
			{"indexed": true,"internalType": "address","name": "token","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
		],
		"name": "Withdrawn","type": "event"
	},
	{
		"inputs": [{"internalType": "address","name": "","type": "address"}],
		"name": "acceptedTokens",
		"outputs": [{"internalType": "bool","name": "","type": "bool"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "_token","type": "address"},{"internalType": "uint256","name": "_amount","type": "uint256"}],
		"name": "deposit","outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "string","name": "_protocolId","type": "string"},{"internalType": "address","name": "_token","type": "address"}],
		"name": "getAllocatedBalance",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "_user","type": "address"},{"internalType": "address","name": "_token","type": "address"}],
		"name": "getUserBalance",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "string","name": "_protocolId","type": "string"},{"internalType": "address","name": "_rewardToken","type": "address"}],
		"name": "harvest","outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "_token","type": "address"},{"internalType": "bool","name": "_isAccepted","type": "bool"}],
		"name": "manageAcceptedToken","outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "string","name": "_protocolId","type": "string"},{"internalType": "address","name": "_protocolAddress","type": "address"}],
		"name": "manageProtocol","outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [],
		"name": "owner",
		"outputs": [{"internalType": "address","name": "","type": "address"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "string","name": "","type": "string"},{"internalType": "address","name": "","type": "address"}],
		"name": "protocolAllocations",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "string","name": "_fromProtocolId","type": "string"},{"internalType": "string","name": "_toProtocolId","type": "string"},{"internalType": "address","name": "_token","type": "address"},{"internalType": "uint256","name": "_amount","type": "uint256"}],
		"name": "rebalance","outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [],
		"name": "renounceOwnership","outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "","type": "address"}],
		"name": "totalTokenBalances",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "newOwner","type": "address"}],
		"name": "transferOwnership","outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "string","name": "","type": "string"}],
		"name": "underlyingProtocols",
		"outputs": [{"internalType": "address","name": "","type": "address"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "","type": "address"},{"internalType": "address","name": "","type": "address"}],
		"name": "userBalances",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "_token","type": "address"},{"internalType": "uint256","name": "_amount","type": "uint256"}],
		"name": "withdraw","outputs": [],"stateMutability": "nonpayable","type": "function"
	}
] as const satisfies Abi;

const bribeCollectorABI = [
	{
		"inputs": [{"internalType": "address","name": "initialOwner","type": "address"},{"internalType": "address","name": "initialBribeRecipient","type": "address"}],
		"stateMutability": "nonpayable","type": "constructor"
	},
	{
		"inputs": [{"internalType": "address","name": "owner","type": "address"}],
		"name": "OwnableInvalidOwner","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "account","type": "address"}],
		"name": "OwnableUnauthorizedAccount","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "token","type": "address"}],
		"name": "SafeERC20FailedOperation","type": "error"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "string","name": "projectId","type": "string"},
			{"indexed": true,"internalType": "address","name": "bribeToken","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "bribeAmount","type": "uint256"},
			{"indexed": false,"internalType": "uint256","name": "durationSeconds","type": "uint256"},
			{"indexed": true,"internalType": "address","name": "payer","type": "address"}
		],
		"name": "BribeReceived","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [{"indexed": true,"internalType": "address","name": "newRecipient","type": "address"}],
		"name": "BribeRecipientChanged","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "token","type": "address"},
			{"indexed": false,"internalType": "bool","name": "isAccepted","type": "bool"}
		],
		"name": "BribeTokenManaged","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "token","type": "address"},
			{"indexed": true,"internalType": "address","name": "recipient","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "amount","type": "uint256"}
		],
		"name": "BribesWithdrawn","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "previousOwner","type": "address"},
			{"indexed": true,"internalType": "address","name": "newOwner","type": "address"}
		],
		"name": "OwnershipTransferred","type": "event"
	},
	{
		"inputs": [{"internalType": "address","name": "","type": "address"}],
		"name": "acceptedBribeTokens",
		"outputs": [{"internalType": "bool","name": "","type": "bool"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [],
		"name": "bribeRecipient",
		"outputs": [{"internalType": "address","name": "","type": "address"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "_token","type": "address"},{"internalType": "bool","name": "_isAccepted","type": "bool"}],
		"name": "manageBribeToken",
		"outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [],
		"name": "owner",
		"outputs": [{"internalType": "address","name": "","type": "address"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [],
		"name": "renounceOwnership",
		"outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "_newRecipient","type": "address"}],
		"name": "setBribeRecipient",
		"outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [
			{"internalType": "string","name": "_projectId","type": "string"},
			{"internalType": "address","name": "_bribeToken","type": "address"},
			{"internalType": "uint256","name": "_bribeAmount","type": "uint256"},
			{"internalType": "uint256","name": "_durationSeconds","type": "uint256"}
		],
		"name": "submitBribe",
		"outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "newOwner","type": "address"}],
		"name": "transferOwnership",
		"outputs": [],"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "_token","type": "address"}],
		"name": "withdrawBribes",
		"outputs": [],"stateMutability": "nonpayable","type": "function"
	}
] as const satisfies Abi;

const erc20Abi = [
	{
		"inputs": [{"internalType": "address","name": "spender","type": "address"},{"internalType": "uint256","name": "allowance","type": "uint256"},{"internalType": "uint256","name": "needed","type": "uint256"}],
		"name": "ERC20InsufficientAllowance","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "sender","type": "address"},{"internalType": "uint256","name": "balance","type": "uint256"},{"internalType": "uint256","name": "needed","type": "uint256"}],
		"name": "ERC20InsufficientBalance","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "approver","type": "address"}],
		"name": "ERC20InvalidApprover","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "receiver","type": "address"}],
		"name": "ERC20InvalidReceiver","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "sender","type": "address"}],
		"name": "ERC20InvalidSender","type": "error"
	},
	{
		"inputs": [{"internalType": "address","name": "spender","type": "address"}],
		"name": "ERC20InvalidSpender","type": "error"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "owner","type": "address"},
			{"indexed": true,"internalType": "address","name": "spender","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "value","type": "uint256"}
		],
		"name": "Approval","type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true,"internalType": "address","name": "from","type": "address"},
			{"indexed": true,"internalType": "address","name": "to","type": "address"},
			{"indexed": false,"internalType": "uint256","name": "value","type": "uint256"}
		],
		"name": "Transfer","type": "event"
	},
	{
		"inputs": [{"internalType": "address","name": "owner","type": "address"},{"internalType": "address","name": "spender","type": "address"}],
		"name": "allowance",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "spender","type": "address"},{"internalType": "uint256","name": "value","type": "uint256"}],
		"name": "approve",
		"outputs": [{"internalType": "bool","name": "","type": "bool"}],
		"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "account","type": "address"}],
		"name": "balanceOf",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [],
		"name": "decimals",
		"outputs": [{"internalType": "uint8","name": "","type": "uint8"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [],
		"name": "name",
		"outputs": [{"internalType": "string","name": "","type": "string"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [],
		"name": "symbol",
		"outputs": [{"internalType": "string","name": "","type": "string"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [],
		"name": "totalSupply",
		"outputs": [{"internalType": "uint256","name": "","type": "uint256"}],
		"stateMutability": "view","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "to","type": "address"},{"internalType": "uint256","name": "value","type": "uint256"}],
		"name": "transfer",
		"outputs": [{"internalType": "bool","name": "","type": "bool"}],
		"stateMutability": "nonpayable","type": "function"
	},
	{
		"inputs": [{"internalType": "address","name": "from","type": "address"},{"internalType": "address","name": "to","type": "address"},{"internalType": "uint256","name": "value","type": "uint256"}],
		"name": "transferFrom",
		"outputs": [{"internalType": "bool","name": "","type": "bool"}],
		"stateMutability": "nonpayable","type": "function"
	}
] as const satisfies Abi;

// --- Basic Validation ---
if (!BOT_TOKEN || !EVM_RPC_URL || !AGENT_PRIVATE_KEY || !YIELD_AGGREGATOR_CONTRACT_ADDRESS || !BRIBE_COLLECTOR_CONTRACT_ADDRESS) {
    console.error("CRITICAL: Missing required environment variables!");
    process.exit(1);
}
if (!AGENT_PRIVATE_KEY.startsWith('0x')) {
    console.warn("AGENT_PRIVATE_KEY might be missing '0x' prefix. Assuming it's raw key.");
    AGENT_PRIVATE_KEY = `0x${AGENT_PRIVATE_KEY}`;
}
if (!isAddress(YIELD_AGGREGATOR_CONTRACT_ADDRESS) || !isAddress(BRIBE_COLLECTOR_CONTRACT_ADDRESS)) {
    console.error("CRITICAL: Invalid contract address format in environment variables.");
    process.exit(1);
}

// --- Viem Setup ---
let publicClient: PublicClient;
let walletClient: WalletClient;
let agentAccount: Account;

try {
    publicClient = createPublicClient({
        chain: TARGET_CHAIN,
        transport: http(), 
    });

    agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);

    walletClient = createWalletClient({
        account: agentAccount,
        chain: TARGET_CHAIN,
        transport: http(),
    });

    console.log(`Agent Wallet Address: ${agentAccount.address}`);
    console.log(`Connected to: ${TARGET_CHAIN.name} (ID: ${TARGET_CHAIN.id})`);
    console.log(`Yield Aggregator Contract: ${YIELD_AGGREGATOR_CONTRACT_ADDRESS}`);
    console.log(`Bribe Collector Contract: ${BRIBE_COLLECTOR_CONTRACT_ADDRESS}`);

} catch (error) {
    console.error("CRITICAL: Failed to initialize viem clients:", error);
    process.exit(1);
}


// --- Database Setup ---
// Stores processed bribe info and token decimals cache
const db = new sqlite3.Database('./bribes_viem_mantle.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error("CRITICAL: Error opening database", err.message);
        process.exit(1);
    } else {
        console.log('Connected to the SQLite database.');
        // Bribes table
        db.run(`CREATE TABLE IF NOT EXISTS bribes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            apy_boost REAL NOT NULL,
            expiry_timestamp INTEGER NOT NULL -- UNIX timestamp (seconds)
        )`, (err) => {
            if (err) console.error("DB Error: creating bribes table", err.message);
        });
        // Cache for token decimals
        db.run(`CREATE TABLE IF NOT EXISTS token_decimals (
             token_address TEXT PRIMARY KEY NOT NULL,
             decimals INTEGER NOT NULL
         )`, (err) => {
             if (err) console.error("DB Error: creating token_decimals table", err.message);
         });
         db.run(`CREATE INDEX IF NOT EXISTS idx_bribes_expiry ON bribes (expiry_timestamp)`, (err) => {
             if(err) console.error("DB Error: creating expiry index", err.message);
         });
    }
});

// --- Helper Functions ---

const tokenDecimalCache: Map<Address, number> = new Map();

async function getTokenDecimals(tokenAddress: Address): Promise<number> {
    const checksummedAddress = getAddress(tokenAddress);
    if (tokenDecimalCache.has(checksummedAddress)) {
        return tokenDecimalCache.get(checksummedAddress)!;
    }

    try {
        const row = await new Promise<{ decimals?: number } | undefined>((resolve, reject) => {
            db.get('SELECT decimals FROM token_decimals WHERE token_address = ?', [checksummedAddress], (err, row) => {
                if (err) reject(new Error(`DB Error fetching decimals: ${err.message}`));
                else resolve(row as { decimals?: number } | undefined);
            });
        });

        if (row?.decimals !== undefined) {
            console.log(`Workspaceed decimals for ${checksummedAddress} from DB: ${row.decimals}`);
            tokenDecimalCache.set(checksummedAddress, row.decimals);
            return row.decimals;
        }
    } catch (dbError) {
        console.error(`Database error checking decimals for ${checksummedAddress}:`, dbError);
    }

    console.log(`Workspaceing decimals for ${checksummedAddress} from chain...`);
    try {
        const decimals = await publicClient.readContract({
            address: checksummedAddress,
            abi: erc20Abi,
            functionName: 'decimals',
        });
        const decimalsNumber = Number(decimals);

        db.run('INSERT OR REPLACE INTO token_decimals (token_address, decimals) VALUES (?, ?)',
            [checksummedAddress, decimalsNumber],
             (err) => { if (err) console.error(`DB Error caching decimals for ${checksummedAddress}:`, err.message); }
        );
        tokenDecimalCache.set(checksummedAddress, decimalsNumber);
        console.log(`Workspaceed decimals for ${checksummedAddress} from chain: ${decimalsNumber}`);
        return decimalsNumber;
    } catch (error) {
        console.error(`Error fetching decimals for ${checksummedAddress}:`, error);
        console.warn(`Could not fetch decimals for ${checksummedAddress}, DEFAULTING TO 18.`);
        tokenDecimalCache.set(checksummedAddress, 18);
        return 18; 
    }
}

function isAdmin(telegramId: number): boolean {
    return ADMIN_TELEGRAM_IDS.includes(String(telegramId));
}

// --- Data Simulation (Mantle Context) ---
async function getSimulatedAPYs(): Promise<Record<string, Record<string, number>>> {
    // IMPORTANT: These IDs must match the `protocolId` you use in your smart contracts.
    // Simulating popular Mantle Network protocols (Agni, FusionX, Init Capital)
    console.log("[Simulated Data] Fetching base APYs for Mantle Protocols...");
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate network delay
    return {
        "Agni_WMNT_USDC_LP": { "WMNT": 25.5, "USDC": 25.5 }, // Example DEX LP
        "FusionX_USDT_Pool": { "USDT": 12.0 },              // Example DEX Pool
        "InitCapital_Lend_WMNT": { "WMNT": 5.2 },           // Example Lending Market
        "MantleSwap_Stable_LP": { "USDC": 8.0, "USDT": 8.0}
    };
}

async function getActiveBribes(): Promise<Record<string, number>> {
     const now = Math.floor(Date.now() / 1000);
     console.log(`[DB Query] Fetching active bribes expiring after ${now}...`);
     try {
         const rows = await new Promise<any[]>((resolve, reject) => {
             db.all(`SELECT project_id, apy_boost FROM bribes WHERE expiry_timestamp > ?`,
                 [now],
                 (err, rows) => {
                     if (err) {
                         reject(new Error(`DB Error fetching active bribes: ${err.message}`));
                     } else {
                         resolve(rows);
                     }
                 });
         });

         const aggregatedBribes: Record<string, number> = {};
         rows.forEach((row) => {
             if (row.project_id && typeof row.apy_boost === 'number') {
                 aggregatedBribes[row.project_id] = (aggregatedBribes[row.project_id] || 0) + row.apy_boost;
             } else {
                 console.warn("Skipping malformed bribe row from DB:", row);
             }
         });
          console.log(`[DB Result] Found ${rows.length} active bribe entries.`);
         return aggregatedBribes; 

     } catch (error) {
          console.error("Failed to fetch active bribes from DB:", error);
          return {}; 
     }
}

// --- Telegram Bot Setup ---
const bot = new Telegraf(BOT_TOKEN!);

bot.start((ctx) => ctx.reply('Welcome to the Mantle Yield Aggregator Bot! Use /help for commands.'));

bot.help((ctx) => ctx.reply(`
Commands:
/status - View current vault allocations on Mantle Sepolia.
/deposithelp - Instructions on how to deposit.
/withdrawhelp - Instructions on how to withdraw.
/bribehelp - Instructions for projects to submit bribes.

Admin Only (Use With Caution!):
/manage_yield_token <token_address> <true|false> - Add/Remove accepted vault token.
/manage_protocol <protocol_id> <protocol_address> - Add/Update underlying protocol target.
/manage_bribe_token <token_address> <true|false> - Add/Remove accepted bribe token in BribeCollector.
`));

// --- Telegram Command Handlers ---

bot.command('status', async (ctx) => {
    await ctx.reply('Fetching contract status from Mantle Sepolia...');
    try {
        let statusReport = '--- Aggregator Status (Mantle) ---\n\n';
        statusReport += '**Vault Allocations:**\n';

        // Known protocols on Mantle Testnet (Simulated IDs)
        const knownProtocols = ["Agni_WMNT_USDC_LP", "FusionX_USDT_Pool", "InitCapital_Lend_WMNT", "MantleSwap_Stable_LP"];
        
        // Use tokenRegistry for status checks
        const knownYieldTokens = tokenRegistry;

        for (const protoId of knownProtocols) {
            statusReport += `  *${protoId}*:\n`;
            let hasAllocation = false;
            for (const [symbol, address] of Object.entries(knownYieldTokens)) {
                if (!isAddress(address)) {
                    statusReport += `    - ${symbol}: (Invalid Address Configured)\n`;
                    hasAllocation = true;
                    continue;
                }
                 try {
                     const allocation = await publicClient.readContract({
                         address: YIELD_AGGREGATOR_CONTRACT_ADDRESS!,
                         abi: yieldAggregatorABI,
                         functionName: 'protocolAllocations',
                         args: [protoId, address]
                     });
                     if (allocation > BigInt(0)) {
                        const decimals = await getTokenDecimals(address);
                        statusReport += `    - ${symbol}: ${formatUnits(allocation, decimals)}\n`;
                        hasAllocation = true;
                     }
                 } catch (readError: any) {
                     console.warn(`Could not read allocation for ${symbol} in ${protoId}: ${readError.shortMessage || readError.message}`);
                     if (!readError.message?.includes('reverted')) {
                        statusReport += `    - ${symbol}: (Error Reading Allocation)\n`;
                        hasAllocation = true;
                     }
                 }
            }
            if (!hasAllocation) statusReport += `    (No allocations found)\n`;
        }

        statusReport += '\n**Total Balances in Vault (Liquid + Allocated):**\n';
        for (const [symbol, address] of Object.entries(knownYieldTokens)) {
            if (!isAddress(address)) continue;
            try {
                const total = await publicClient.readContract({
                     address: YIELD_AGGREGATOR_CONTRACT_ADDRESS!,
                     abi: yieldAggregatorABI,
                     functionName: 'totalTokenBalances',
                     args: [address]
                 });
                if (total > BigInt(0)) {
                    const decimals = await getTokenDecimals(address);
                    statusReport += `  * ${symbol}: ${formatUnits(total, decimals)}\n`;
                }
            } catch (readError: any) {
                 console.warn(`Could not read total balance for ${symbol}: ${readError.shortMessage || readError.message}`);
                 statusReport += `  * ${symbol}: (Error Reading Total)\n`;
            }
        }

        await ctx.replyWithMarkdownV2(statusReport.replace(/([_*\[\]()~`>#+-=|{}.!])/g, '\\$1')); 

    } catch (error: any) {
        console.error("Error processing /status:", error);
        await ctx.reply(`Sorry, could not fetch contract status: ${error.shortMessage || error.message}`);
    }
});

bot.command('deposithelp', (ctx) => {
    ctx.reply(`To deposit into the Yield Aggregator:
1.  **Approve:** Use the token's contract to approve the Aggregator (${YIELD_AGGREGATOR_CONTRACT_ADDRESS}) to spend your tokens.
2.  **Deposit:** Call 'deposit' on the Aggregator (${YIELD_AGGREGATOR_CONTRACT_ADDRESS}) with token address and amount.

Use Mantle Explorer to interact.`);
});

bot.command('withdrawhelp', (ctx) => {
    ctx.reply(`To withdraw:
1.  Call 'withdraw' on the Aggregator (${YIELD_AGGREGATOR_CONTRACT_ADDRESS}) with token address and amount.

Withdrawals depend on liquidity. Agent may need to rebalance first.`);
});

bot.command('bribehelp', (ctx) => {
    ctx.reply(`Projects - To submit a bribe on Mantle:
1.  **Approve:** Use your bribe token's contract (e.g., USDC) to approve the Bribe Collector (${BRIBE_COLLECTOR_CONTRACT_ADDRESS}).
2.  **Submit:** Call 'submitBribe' on the Bribe Collector (${BRIBE_COLLECTOR_CONTRACT_ADDRESS}).
    - \`_projectId\`: Your unique ID (e.g., "Agni_WMNT_USDC_LP").
    - \`_bribeToken\`: Address of the token.
    - \`_bribeAmount\`: Amount in smallest unit.
    - \`_durationSeconds\`: Duration in seconds.

The agent detects successful bribes automatically.`);
});


// --- Admin Commands (using viem) ---

async function sendAdminTx(
    ctx: any, 
    contractAddress: Address,
    abi: Abi,
    functionName: string,
    args: unknown[] 
): Promise<void> {
    if (!isAdmin(ctx.from.id)) {
        await ctx.reply('Unauthorized.');
        return;
    }
    try {
        await ctx.reply(`Simulating ${functionName} transaction on Mantle...`);
        const { request } = await publicClient.simulateContract({
            address: contractAddress,
            abi: abi,
            functionName: functionName,
            args: args,
            account: agentAccount, 
        });

        await ctx.reply(`Simulation successful. Sending transaction...`);
        const hash = await walletClient.writeContract(request);

        const explorerUrl = TARGET_CHAIN.blockExplorers?.default.url;
        const txUrl = explorerUrl ? `${explorerUrl}/tx/${hash}` : `Hash: ${hash}`;
        await ctx.reply(`Transaction sent: ${txUrl}\nWaiting for confirmation...`);

        const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status === 'success') {
            await ctx.reply(`✅ Transaction confirmed successfully!\nBlock: ${receipt.blockNumber}`);
            console.log(`${functionName} tx ${hash} confirmed.`);
        } else {
            await ctx.reply(`❌ Transaction failed! Status: ${receipt.status}\nBlock: ${receipt.blockNumber}`);
            console.error(`${functionName} tx ${hash} failed.`);
        }
    } catch (error: unknown) { 
        console.error(`Error executing ${functionName}:`, error);
        let errorMessage = 'An unknown error occurred.';
        if (error instanceof Error) {
            if (error instanceof ContractFunctionExecutionError) {
                errorMessage = `Contract execution failed: ${error.shortMessage}`;
            } else {
                errorMessage = error.message;
            }
        } else if (typeof error === 'string') {
             errorMessage = error;
        }
        await ctx.reply(`Failed to execute ${functionName}: ${errorMessage}`);
    }
}

bot.command('manage_yield_token', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length !== 3 || !['true', 'false'].includes(parts[2])) {
        return ctx.reply('Usage: /manage_yield_token <token_address> <true|false>');
    }
    const [, tokenAddressStr, acceptedStr] = parts;
    if (!isAddress(tokenAddressStr)) return ctx.reply('Invalid token address format.');
    const tokenAddress = getAddress(tokenAddressStr); 
    const isAccepted = acceptedStr === 'true';

    await sendAdminTx(ctx, YIELD_AGGREGATOR_CONTRACT_ADDRESS!, yieldAggregatorABI, 'manageAcceptedToken', [tokenAddress, isAccepted]);
});

bot.command('manage_protocol', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length !== 3) {
        return ctx.reply('Usage: /manage_protocol <protocol_id_string> <protocol_address>');
    }
    const [, protocolId, protocolAddressStr] = parts;
     if (!isAddress(protocolAddressStr)) return ctx.reply('Invalid protocol address format.');
    const protocolAddress = getAddress(protocolAddressStr);

    await sendAdminTx(ctx, YIELD_AGGREGATOR_CONTRACT_ADDRESS!, yieldAggregatorABI, 'manageProtocol', [protocolId, protocolAddress]);
});

bot.command('manage_bribe_token', async (ctx) => {
    const parts = ctx.message.text.split(' ');
     if (parts.length !== 3 || !['true', 'false'].includes(parts[2])) {
        return ctx.reply('Usage: /manage_bribe_token <token_address> <true|false>');
    }
    const [, tokenAddressStr, acceptedStr] = parts;
     if (!isAddress(tokenAddressStr)) return ctx.reply('Invalid token address format.');
    const tokenAddress = getAddress(tokenAddressStr);
    const isAccepted = acceptedStr === 'true';

    await sendAdminTx(ctx, BRIBE_COLLECTOR_CONTRACT_ADDRESS!, bribeCollectorABI, 'manageBribeToken', [tokenAddress, isAccepted]);
});

// --- Event Listener for Bribes ---

let unwatchBribeEvents: (() => void) | null = null; 

function startBribeListener() {
    if (unwatchBribeEvents) {
        console.log("Stopping existing bribe listener...");
        unwatchBribeEvents(); 
    }
    console.log(`Starting listener for BribeReceived events on ${BRIBE_COLLECTOR_CONTRACT_ADDRESS}...`);

    try {
        unwatchBribeEvents = publicClient.watchContractEvent({
            address: BRIBE_COLLECTOR_CONTRACT_ADDRESS!,
            abi: bribeCollectorABI,
            eventName: 'BribeReceived',
            onLogs: async (logs: Log<bigint, number, false, undefined, true, typeof bribeCollectorABI, 'BribeReceived'>[]) => {
                console.log(`Received ${logs.length} BribeReceived event(s)`);
                for (const log of logs) {
                    try {
                        const args = log.args;
                        if (!args || !args.projectId || !args.bribeToken || args.bribeAmount === undefined || args.durationSeconds === undefined || !log.blockNumber) {
                            console.warn("Skipping incomplete BribeReceived event log:", log);
                            continue;
                        }

                        const { projectId, bribeToken, bribeAmount, durationSeconds } = args;
                        const blockNumber = log.blockNumber;

                        console.log(`Processing Bribe: Project=${projectId}, Token=${bribeToken}, Amount=${bribeAmount}, Duration=${durationSeconds}s, Block=${blockNumber}`);

                        const block = await publicClient.getBlock({ blockNumber });
                        const blockTimestamp = block.timestamp;
                        const expiryTimestamp = blockTimestamp + durationSeconds; 

                        const decimals = await getTokenDecimals(bribeToken);

                        const amountNumber = Number(bribeAmount) / (10 ** decimals);
                        const durationDays = Number(durationSeconds) / 86400; 
                        const apyBoost = durationDays > 0
                            ? (amountNumber / durationDays) * BRIBE_APY_SCALE_FACTOR
                            : 0;

                        if (apyBoost <= 0) {
                            console.warn(`Calculated zero or negative APY boost for bribe ${projectId}. Skipping.`);
                            continue;
                        }

                        console.log(`  Calculated APY Boost: ${apyBoost.toFixed(4)}%`);
                        console.log(`  Expiry Timestamp (Unix): ${expiryTimestamp}`);

                        db.run(`INSERT INTO bribes (project_id, apy_boost, expiry_timestamp) VALUES (?, ?, ?)`,
                            [projectId, apyBoost, Number(expiryTimestamp)], 
                            (err) => {
                                if (err) {
                                    console.error(`DB Error storing bribe for ${projectId}:`, err);
                                } else {
                                    console.log(`✅ Successfully stored bribe for ${projectId}`);
                                }
                            }
                        );

                    } catch (processingError) {
                        console.error("Error processing individual BribeReceived event:", processingError, "Log:", log);
                    }
                } 
            },
            onError: (error) => {
                console.error('ERROR in watchContractEvent for Bribes:', error);
                if (unwatchBribeEvents) unwatchBribeEvents();
                unwatchBribeEvents = null;
                console.log("Attempting to restart bribe listener in 15 seconds...");
                setTimeout(startBribeListener, 15000);
            },
            poll: true, 
            pollingInterval: 8_000, 
        });
        console.log("Bribe listener setup complete.");
    } catch (listenerError) {
         console.error("CRITICAL: Failed to initialize bribe listener:", listenerError);
         console.log("Retrying listener setup in 30 seconds...");
         setTimeout(startBribeListener, 30000);
    }
}

// --- Core Agent Rebalance Logic ---

async function runRebalanceCycle() {
    console.log(`[${new Date().toISOString()}] --- Starting Rebalance Cycle (Mantle) ---`);
    let rebalanceOccurred = false;
    try {
        const baseAPYs = await getSimulatedAPYs();
        const activeBribes = await getActiveBribes(); 

        // 1. Calculate Effective APYs
        const effectiveAPYs: Record<string, Record<string, number>> = {};
        console.log("[Data] Base APYs:", JSON.stringify(baseAPYs));
        console.log("[Data] Active Bribes:", JSON.stringify(activeBribes));

        const allProtocolIds = new Set([...Object.keys(baseAPYs), ...Object.keys(activeBribes)]);

        for (const protocolId of allProtocolIds) {
            effectiveAPYs[protocolId] = {};
            const protocolBaseAPYs = baseAPYs[protocolId] || {};
            const bribeBoost = activeBribes[protocolId] || 0;

             for (const tokenSymbol of Object.keys(tokenRegistry)) {
                 const baseAPY = protocolBaseAPYs[tokenSymbol] ?? 0; 
                 if (baseAPY > 0 || bribeBoost > 0) {
                     const effective = baseAPY + bribeBoost;
                     effectiveAPYs[protocolId][tokenSymbol] = effective;
                     if (bribeBoost > 0 && baseAPY > 0) { 
                         console.log(`  Boost Applied: ${protocolId} for ${tokenSymbol}. Base: ${baseAPY.toFixed(4)}%, Boost: ${bribeBoost.toFixed(4)}%, Effective: ${effective.toFixed(4)}%`);
                     } else if (bribeBoost > 0) { 
                        console.log(`  Boost Only: ${protocolId} for ${tokenSymbol}. Boost: ${bribeBoost.toFixed(4)}%, Effective: ${effective.toFixed(4)}%`);
                     }
                 }
             }
        }
        console.log("[Calculation] Effective APYs:", JSON.stringify(effectiveAPYs));

        // 2. Determine Optimal Allocation
        for (const [tokenSymbol, tokenAddress] of Object.entries(tokenRegistry)) {
             console.log(`\n-- Optimizing for ${tokenSymbol} (${tokenAddress}) --`);
            let bestAPY = -Infinity; 
            let bestProtocolId = "AGGREGATOR_VAULT"; 

            for (const protocolId in effectiveAPYs) {
                const currentTokenAPY = effectiveAPYs[protocolId]?.[tokenSymbol];
                if (currentTokenAPY !== undefined && currentTokenAPY > bestAPY) {
                    bestAPY = currentTokenAPY;
                    bestProtocolId = protocolId;
                }
            }

             if (bestAPY <= 0) { 
                console.log(`  No positive yield found for ${tokenSymbol}. Optimal: AGGREGATOR_VAULT (Liquid).`);
                bestProtocolId = "AGGREGATOR_VAULT";
            } else {
                 console.log(`  Optimal Allocation: ${bestProtocolId} @ ${bestAPY.toFixed(4)}% APY`);
            }

            // 3. Compare with Current On-Chain Allocation
            let totalTokenBalance: bigint;
            let tokenDecimals: number;
            try {
                 totalTokenBalance = await publicClient.readContract({
                    address: YIELD_AGGREGATOR_CONTRACT_ADDRESS!,
                    abi: yieldAggregatorABI,
                    functionName: 'totalTokenBalances',
                    args: [tokenAddress]
                 });
                 tokenDecimals = await getTokenDecimals(tokenAddress);
             } catch (e: any) {
                 console.error(`  ERROR: Failed to read total balance/decimals for ${tokenSymbol}. Skipping. Error: ${e.shortMessage || e.message}`);
                 continue; 
             }

            if (totalTokenBalance === BigInt(0)) {
                console.log(`  No ${tokenSymbol} balance in vault. Skipping.`);
                continue;
            }
            console.log(`  Total Vault Balance: ${formatUnits(totalTokenBalance, tokenDecimals)} ${tokenSymbol}`);

            let currentProtocolId = "AGGREGATOR_VAULT";
            let currentAllocation = BigInt(0);
             for (const protoId of allProtocolIds) { 
                 try {
                     const allocation = await publicClient.readContract({
                         address: YIELD_AGGREGATOR_CONTRACT_ADDRESS!,
                         abi: yieldAggregatorABI,
                         functionName: 'protocolAllocations',
                         args: [protoId, tokenAddress]
                     });
                     if (allocation > BigInt(0)) {
                         currentProtocolId = protoId;
                         currentAllocation = totalTokenBalance; // Assuming simple allocation logic
                         break;
                     }
                 } catch (readError:any) {
                     // Ignore errors here
                 }
             }
            if (currentProtocolId === "AGGREGATOR_VAULT") {
                currentAllocation = totalTokenBalance;
            }
            console.log(`  Current Allocation: ${formatUnits(currentAllocation, tokenDecimals)} ${tokenSymbol} in ${currentProtocolId}`);


            // 4. Execute Rebalance
            if (bestProtocolId !== currentProtocolId) {
                const amountToMove = currentAllocation; 

                if (amountToMove > BigInt(0)) {
                    console.log(`  >>> ACTION: Rebalancing ${formatUnits(amountToMove, tokenDecimals)} ${tokenSymbol} from ${currentProtocolId} TO ${bestProtocolId}...`);
                    rebalanceOccurred = true;
                    try {
                         const { request } = await publicClient.simulateContract({
                             address: YIELD_AGGREGATOR_CONTRACT_ADDRESS!,
                             abi: yieldAggregatorABI,
                             functionName: 'rebalance',
                             args: [currentProtocolId, bestProtocolId, tokenAddress, amountToMove],
                             account: agentAccount,
                         });
                         const hash = await walletClient.writeContract(request);
                         const explorerUrl = TARGET_CHAIN.blockExplorers?.default.url;
                         const txUrl = explorerUrl ? `${explorerUrl}/tx/${hash}` : `Hash: ${hash}`;
                         console.log(`    Tx Sent: ${txUrl}. Waiting for confirmation...`);

                         publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
                             .then((receipt: TransactionReceipt) => {
                                 if (receipt.status === 'success') {
                                     console.log(`    ✅ Rebalance CONFIRMED for ${tokenSymbol} (${hash}).`);
                                 } else {
                                     console.error(`    ❌ Rebalance FAILED for ${tokenSymbol} (${hash}).`);
                                 }
                             })
                             .catch(waitErr => {
                                 console.error(`    ⚠️ Error waiting for rebalance tx ${hash}:`, waitErr);
                             });

                    } catch (txError: any) {
                        console.error(`  ⛔️ ERROR Simulating/Sending Rebalance Tx for ${tokenSymbol}: ${txError?.shortMessage || txError?.message}`);
                        if (txError.cause) console.error("  -> Cause:", txError.cause);
                    }
                } else {
                     console.log(`  Skipping rebalance for ${tokenSymbol} - amount to move is zero.`);
                }
            } else {
                 console.log(`  No rebalance needed for ${tokenSymbol}. Already optimal.`);
            }
        } 

    } catch (error) {
        console.error("Error during rebalance cycle:", error);
    } finally {
         console.log(`[${new Date().toISOString()}] --- Rebalance Cycle Finished ${rebalanceOccurred ? '(Rebalances Initiated)' : '(No Rebalances Needed)'} ---`);
    }
}

// --- Bot Launch ---
async function main() {
    try {
        const blockNumber = await publicClient.getBlockNumber();
        console.log(`Successfully connected to ${TARGET_CHAIN.name}. Current block: ${blockNumber}`);

        await bot.launch();
        console.log('Telegram bot started successfully.');

        startBribeListener();

        console.log("Running initial rebalance cycle...");
        await runRebalanceCycle(); 
        console.log(`Starting periodic rebalance cycle every ${REBALANCE_INTERVAL_MS / 1000 / 60} minutes.`);
        setInterval(runRebalanceCycle, REBALANCE_INTERVAL_MS);

    } catch (error) {
        console.error("CRITICAL: Failed to initialize agent:", error);
        process.exit(1);
    }
}

const shutdown = (signal: string) => {
    console.log(`\n${signal} received. Shutting down...`);
    bot.stop(signal);
    if (unwatchBribeEvents) {
        console.log("Stopping bribe listener...");
        unwatchBribeEvents();
    }
    db.close((err) => {
        if (err) {
            console.error("Error closing database:", err.message);
            process.exit(1);
        } else {
            console.log("Database connection closed.");
            process.exit(0);
        }
    });
    setTimeout(() => {
        console.error("Forcing shutdown after timeout.");
        process.exit(1);
    }, 5000); 
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(error => {
    console.error("Unhandled error during agent startup:", error);
    process.exit(1);
});