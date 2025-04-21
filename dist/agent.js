"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// agent.ts (Using TypeScript for better type safety with viem)
const telegraf_1 = require("telegraf");
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
const sqlite3_1 = __importDefault(require("sqlite3"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// --- Configuration & Constants ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const EVM_RPC_URL = process.env.EVM_RPC_URL || 'https://bepolia.rpc.berachain.com/';
var AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const YIELD_AGGREGATOR_CONTRACT_ADDRESS = process.env.YIELD_AGGREGATOR_CONTRACT_ADDRESS;
const BRIBE_COLLECTOR_CONTRACT_ADDRESS = process.env.BRIBE_COLLECTOR_CONTRACT_ADDRESS;
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => id.trim()).filter(id => id);
const REBALANCE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BRIBE_APY_SCALE_FACTOR = 0.01; // Scale factor for APY boost calculation
// Define Berachain Testnet
const berachainArtio = (0, viem_1.defineChain)({
    id: 80069,
    name: 'Berachain Bepolia',
    nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
    rpcUrls: {
        default: { http: [EVM_RPC_URL] }, // Use from .env or default
        public: { http: ['https://bepolia.rpc.berachain.com/'] },
    },
    blockExplorers: {
        default: { name: 'Beratrail', url: 'https://bepolia.beratrail.io/' },
    },
    testnet: true,
});
const TARGET_CHAIN = chains_1.berachainBepolia;
const yieldAggregatorABI = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "initialOwner",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "owner",
                "type": "address"
            }
        ],
        "name": "OwnableInvalidOwner",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "OwnableUnauthorizedAccount",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "token",
                "type": "address"
            }
        ],
        "name": "SafeERC20FailedOperation",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "Deposited",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "agent",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "string",
                "name": "protocolId",
                "type": "string"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "rewardToken",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "Harvested",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "previousOwner",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "string",
                "name": "protocolId",
                "type": "string"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "protocolAddress",
                "type": "address"
            }
        ],
        "name": "ProtocolAdded",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "agent",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "fromProtocolId",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "toProtocolId",
                "type": "string"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "Rebalanced",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "bool",
                "name": "isAccepted",
                "type": "bool"
            }
        ],
        "name": "TokenAccepted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "user",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "Withdrawn",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "acceptedTokens",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "_amount",
                "type": "uint256"
            }
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_protocolId",
                "type": "string"
            },
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            }
        ],
        "name": "getAllocatedBalance",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_user",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            }
        ],
        "name": "getUserBalance",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_protocolId",
                "type": "string"
            },
            {
                "internalType": "address",
                "name": "_rewardToken",
                "type": "address"
            }
        ],
        "name": "harvest",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            },
            {
                "internalType": "bool",
                "name": "_isAccepted",
                "type": "bool"
            }
        ],
        "name": "manageAcceptedToken",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_protocolId",
                "type": "string"
            },
            {
                "internalType": "address",
                "name": "_protocolAddress",
                "type": "address"
            }
        ],
        "name": "manageProtocol",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            },
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "protocolAllocations",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_fromProtocolId",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "_toProtocolId",
                "type": "string"
            },
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "_amount",
                "type": "uint256"
            }
        ],
        "name": "rebalance",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "totalTokenBalances",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "name": "underlyingProtocols",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "userBalances",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "_amount",
                "type": "uint256"
            }
        ],
        "name": "withdraw",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];
const bribeCollectorABI = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "initialOwner",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "initialBribeRecipient",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "owner",
                "type": "address"
            }
        ],
        "name": "OwnableInvalidOwner",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "OwnableUnauthorizedAccount",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "token",
                "type": "address"
            }
        ],
        "name": "SafeERC20FailedOperation",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "string",
                "name": "projectId",
                "type": "string"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "bribeToken",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "bribeAmount",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "durationSeconds",
                "type": "uint256"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "payer",
                "type": "address"
            }
        ],
        "name": "BribeReceived",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "newRecipient",
                "type": "address"
            }
        ],
        "name": "BribeRecipientChanged",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "bool",
                "name": "isAccepted",
                "type": "bool"
            }
        ],
        "name": "BribeTokenManaged",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "recipient",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "BribesWithdrawn",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "previousOwner",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "acceptedBribeTokens",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "bribeRecipient",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            },
            {
                "internalType": "bool",
                "name": "_isAccepted",
                "type": "bool"
            }
        ],
        "name": "manageBribeToken",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_newRecipient",
                "type": "address"
            }
        ],
        "name": "setBribeRecipient",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_projectId",
                "type": "string"
            },
            {
                "internalType": "address",
                "name": "_bribeToken",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "_bribeAmount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_durationSeconds",
                "type": "uint256"
            }
        ],
        "name": "submitBribe",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_token",
                "type": "address"
            }
        ],
        "name": "withdrawBribes",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];
const erc20Abi = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "spender",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "allowance",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "needed",
                "type": "uint256"
            }
        ],
        "name": "ERC20InsufficientAllowance",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "sender",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "balance",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "needed",
                "type": "uint256"
            }
        ],
        "name": "ERC20InsufficientBalance",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "approver",
                "type": "address"
            }
        ],
        "name": "ERC20InvalidApprover",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "receiver",
                "type": "address"
            }
        ],
        "name": "ERC20InvalidReceiver",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "sender",
                "type": "address"
            }
        ],
        "name": "ERC20InvalidSender",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "spender",
                "type": "address"
            }
        ],
        "name": "ERC20InvalidSpender",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "owner",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "spender",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            }
        ],
        "name": "Approval",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "from",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "to",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            }
        ],
        "name": "Transfer",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "owner",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "spender",
                "type": "address"
            }
        ],
        "name": "allowance",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "spender",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            }
        ],
        "name": "approve",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "balanceOf",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [
            {
                "internalType": "uint8",
                "name": "",
                "type": "uint8"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "name",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "symbol",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalSupply",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "to",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            }
        ],
        "name": "transfer",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "from",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "to",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            }
        ],
        "name": "transferFrom",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];
// --- Basic Validation ---
if (!BOT_TOKEN || !EVM_RPC_URL || !AGENT_PRIVATE_KEY || !YIELD_AGGREGATOR_CONTRACT_ADDRESS || !BRIBE_COLLECTOR_CONTRACT_ADDRESS) {
    console.error("CRITICAL: Missing required environment variables!");
    process.exit(1);
}
if (!AGENT_PRIVATE_KEY.startsWith('0x')) {
    console.warn("AGENT_PRIVATE_KEY might be missing '0x' prefix. Assuming it's raw key.");
    AGENT_PRIVATE_KEY = `0x${AGENT_PRIVATE_KEY}`;
}
if (!(0, viem_1.isAddress)(YIELD_AGGREGATOR_CONTRACT_ADDRESS) || !(0, viem_1.isAddress)(BRIBE_COLLECTOR_CONTRACT_ADDRESS)) {
    console.error("CRITICAL: Invalid contract address format in environment variables.");
    process.exit(1);
}
// --- Viem Setup ---
let publicClient;
let walletClient;
let agentAccount;
try {
    publicClient = (0, viem_1.createPublicClient)({
        chain: TARGET_CHAIN,
        transport: (0, viem_1.http)(), // Uses RPC URL defined in the chain object
    });
    agentAccount = (0, accounts_1.privateKeyToAccount)(AGENT_PRIVATE_KEY);
    walletClient = (0, viem_1.createWalletClient)({
        account: agentAccount,
        chain: TARGET_CHAIN,
        transport: (0, viem_1.http)(),
    });
    console.log(`Agent Wallet Address: ${agentAccount.address}`);
    console.log(`Connected to: ${TARGET_CHAIN.name} (ID: ${TARGET_CHAIN.id})`);
    console.log(`Yield Aggregator Contract: ${YIELD_AGGREGATOR_CONTRACT_ADDRESS}`);
    console.log(`Bribe Collector Contract: ${BRIBE_COLLECTOR_CONTRACT_ADDRESS}`);
}
catch (error) {
    console.error("CRITICAL: Failed to initialize viem clients:", error);
    process.exit(1);
}
// --- Database Setup ---
// (Ensure SQLite is appropriate for your scale, consider PostgreSQL for production)
const db = new sqlite3_1.default.Database('./bribes_viem_bera.db', sqlite3_1.default.OPEN_READWRITE | sqlite3_1.default.OPEN_CREATE, (err) => {
    if (err) {
        console.error("CRITICAL: Error opening database", err.message);
        process.exit(1);
    }
    else {
        console.log('Connected to the SQLite database.');
        // Bribes table stores processed bribe info
        db.run(`CREATE TABLE IF NOT EXISTS bribes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            apy_boost REAL NOT NULL,
            expiry_timestamp INTEGER NOT NULL -- UNIX timestamp (seconds)
        )`, (err) => {
            if (err)
                console.error("DB Error: creating bribes table", err.message);
        });
        // Cache for token decimals
        db.run(`CREATE TABLE IF NOT EXISTS token_decimals (
             token_address TEXT PRIMARY KEY NOT NULL,
             decimals INTEGER NOT NULL
         )`, (err) => {
            if (err)
                console.error("DB Error: creating token_decimals table", err.message);
        });
        // Optional: Index for faster expiry lookup
        db.run(`CREATE INDEX IF NOT EXISTS idx_bribes_expiry ON bribes (expiry_timestamp)`, (err) => {
            if (err)
                console.error("DB Error: creating expiry index", err.message);
        });
    }
});
// --- Helper Functions ---
// Simple in-memory cache for decimals (cleared on restart)
const tokenDecimalCache = new Map();
function getTokenDecimals(tokenAddress) {
    return __awaiter(this, void 0, void 0, function* () {
        const checksummedAddress = (0, viem_1.getAddress)(tokenAddress);
        if (tokenDecimalCache.has(checksummedAddress)) {
            return tokenDecimalCache.get(checksummedAddress);
        }
        try {
            // Check DB first
            const row = yield new Promise((resolve, reject) => {
                db.get('SELECT decimals FROM token_decimals WHERE token_address = ?', [checksummedAddress], (err, row) => {
                    if (err)
                        reject(new Error(`DB Error fetching decimals: ${err.message}`));
                    else
                        resolve(row);
                });
            });
            if ((row === null || row === void 0 ? void 0 : row.decimals) !== undefined) {
                console.log(`Workspaceed decimals for ${checksummedAddress} from DB: ${row.decimals}`);
                tokenDecimalCache.set(checksummedAddress, row.decimals);
                return row.decimals;
            }
        }
        catch (dbError) {
            console.error(`Database error checking decimals for ${checksummedAddress}:`, dbError);
            // Proceed to fetch from chain
        }
        // Fetch from contract
        console.log(`Workspaceing decimals for ${checksummedAddress} from chain...`);
        try {
            const decimals = yield publicClient.readContract({
                address: checksummedAddress,
                abi: erc20Abi,
                functionName: 'decimals',
            });
            const decimalsNumber = Number(decimals);
            // Store in DB and cache
            db.run('INSERT OR REPLACE INTO token_decimals (token_address, decimals) VALUES (?, ?)', [checksummedAddress, decimalsNumber], (err) => { if (err)
                console.error(`DB Error caching decimals for ${checksummedAddress}:`, err.message); });
            tokenDecimalCache.set(checksummedAddress, decimalsNumber);
            console.log(`Workspaceed decimals for ${checksummedAddress} from chain: ${decimalsNumber}`);
            return decimalsNumber;
        }
        catch (error) {
            console.error(`Error fetching decimals for ${checksummedAddress}:`, error);
            console.warn(`Could not fetch decimals for ${checksummedAddress}, DEFAULTING TO 18.`);
            tokenDecimalCache.set(checksummedAddress, 18); // Cache default on failure
            return 18; // Default to 18 if lookup fails
        }
    });
}
function isAdmin(telegramId) {
    return ADMIN_TELEGRAM_IDS.includes(String(telegramId));
}
// Simulate fetching APYs - HAVE TO REPLACE WITH ACTUAL DATA SOURCE INTEGRATION
function getSimulatedAPYs() {
    return __awaiter(this, void 0, void 0, function* () {
        // Format: { "protocolIdString": { "TOKEN_SYMBOL": APY_Percentage, ... }, ... }
        // IMPORTANT: Use consistent token symbols/identifiers matched with your tokenRegistry
        console.log("[Simulated Data] Fetching base APYs...");
        yield new Promise(resolve => setTimeout(resolve, 50)); // Simulate network delay
        return {
            // Ensure these IDs match what projects use when bribing
            "BEX_HONEY_WBERA_LP": { "HONEY_WBERA_LP": 35.2 }, // Example BEX LP Pool
            "Bend_HONEY_Market": { "HONEY": 8.1 }, // Example Lending Market
            "Berps_BERA_Vault": { "BERA": 15.5 }, // Example Perp Vault
            "Station_HONEY_Stake": { "HONEY": 12.0 },
        };
    });
}
// Fetch active bribes from the DB
function getActiveBribes() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = Math.floor(Date.now() / 1000);
        console.log(`[DB Query] Fetching active bribes expiring after ${now}...`);
        try {
            const rows = yield new Promise((resolve, reject) => {
                // Select bribes that haven't expired yet
                db.all(`SELECT project_id, apy_boost FROM bribes WHERE expiry_timestamp > ?`, [now], (err, rows) => {
                    if (err) {
                        reject(new Error(`DB Error fetching active bribes: ${err.message}`));
                    }
                    else {
                        resolve(rows);
                    }
                });
            });
            const aggregatedBribes = {};
            rows.forEach((row) => {
                if (row.project_id && typeof row.apy_boost === 'number') {
                    aggregatedBribes[row.project_id] = (aggregatedBribes[row.project_id] || 0) + row.apy_boost;
                }
                else {
                    console.warn("Skipping malformed bribe row from DB:", row);
                }
            });
            console.log(`[DB Result] Found ${rows.length} active bribe entries.`);
            return aggregatedBribes; // Format: { "protocolId": total_apy_boost, ... }
        }
        catch (error) {
            console.error("Failed to fetch active bribes from DB:", error);
            return {}; // Return empty object on error
        }
    });
}
// --- Telegram Bot Setup ---
const bot = new telegraf_1.Telegraf(BOT_TOKEN); // Add '!' assuming validation passed
bot.start((ctx) => ctx.reply('Welcome to the Berachain Yield Aggregator Bot! Use /help for commands.'));
bot.help((ctx) => ctx.reply(`
Commands:
/status - View current vault allocations.
/deposithelp - Instructions on how to deposit.
/withdrawhelp - Instructions on how to withdraw.
/bribehelp - Instructions for projects to submit bribes.

Admin Only (Use With Caution!):
/manage_yield_token <token_address> <true|false> - Add/Remove accepted vault token.
/manage_protocol <protocol_id> <protocol_address> - Add/Update underlying protocol target.
/manage_bribe_token <token_address> <true|false> - Add/Remove accepted bribe token in BribeCollector.
`));
// --- Telegram Command Handlers ---
bot.command('status', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield ctx.reply('Fetching contract status from Berachain...');
    try {
        let statusReport = '--- Aggregator Status ---\n\n';
        statusReport += '**Vault Allocations:**\n';
        // !! IMPORTANT: Replace with dynamic fetching or robust config !!
        const knownProtocols = ["BEX_HONEY_WBERA_LP", "Bend_HONEY_Market", "Berps_BERA_Vault", "Station_HONEY_Stake"];
        // Replace with actual addresses on Berachain Artio for corresponding tokens/LPs
        const knownYieldTokens = {
            "HONEY": "0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce",
            "BERA": "0x6969696969696969696969696969696969696969", // Or use native BERA address if wrapped
            "HONEY_WBERA_LP": "0x2c4a603a2aa5596287a06886862dc29d56dbc354" // Address of the BEX LP token
        };
        for (const protoId of knownProtocols) {
            statusReport += `  *${protoId}*:\n`;
            let hasAllocation = false;
            for (const [symbol, address] of Object.entries(knownYieldTokens)) {
                if (!(0, viem_1.isAddress)(address)) { // Basic check on placeholder
                    statusReport += `    - ${symbol}: (Invalid Address Configured)\n`;
                    hasAllocation = true;
                    continue;
                }
                try {
                    const allocation = yield publicClient.readContract({
                        address: YIELD_AGGREGATOR_CONTRACT_ADDRESS,
                        abi: yieldAggregatorABI,
                        functionName: 'protocolAllocations',
                        args: [protoId, address]
                    });
                    if (allocation > BigInt(0)) {
                        const decimals = yield getTokenDecimals(address);
                        statusReport += `    - ${symbol}: ${(0, viem_1.formatUnits)(allocation, decimals)}\n`;
                        hasAllocation = true;
                    }
                }
                catch (readError) {
                    console.warn(`Could not read allocation for ${symbol} in ${protoId}: ${readError.shortMessage || readError.message}`);
                    // Only show error if it's not a 'contract reverted' likely meaning protocol doesn't exist or support token
                    if (!((_a = readError.message) === null || _a === void 0 ? void 0 : _a.includes('reverted'))) {
                        statusReport += `    - ${symbol}: (Error Reading Allocation)\n`;
                        hasAllocation = true;
                    }
                }
            }
            if (!hasAllocation)
                statusReport += `    (No allocations found for known tokens)\n`;
        }
        statusReport += '\n**Total Balances in Vault (Liquid + Allocated):**\n';
        for (const [symbol, address] of Object.entries(knownYieldTokens)) {
            if (!(0, viem_1.isAddress)(address))
                continue;
            try {
                const total = yield publicClient.readContract({
                    address: YIELD_AGGREGATOR_CONTRACT_ADDRESS,
                    abi: yieldAggregatorABI,
                    functionName: 'totalTokenBalances',
                    args: [address]
                });
                if (total > BigInt(0)) {
                    const decimals = yield getTokenDecimals(address);
                    statusReport += `  * ${symbol}: ${(0, viem_1.formatUnits)(total, decimals)}\n`;
                }
            }
            catch (readError) {
                console.warn(`Could not read total balance for ${symbol}: ${readError.shortMessage || readError.message}`);
                statusReport += `  * ${symbol}: (Error Reading Total)\n`;
            }
        }
        yield ctx.replyWithMarkdownV2(statusReport.replace(/([_*\[\]()~`>#+-=|{}.!])/g, '\\$1')); // Escape markdown
    }
    catch (error) {
        console.error("Error processing /status:", error);
        yield ctx.reply(`Sorry, could not fetch contract status: ${error.shortMessage || error.message}`);
    }
}));
// Help commands remain the same, just ensure addresses are correct
bot.command('deposithelp', (ctx) => {
    ctx.reply(`To deposit into the Yield Aggregator:
1.  **Approve:** Use the token's contract to approve the Aggregator (${YIELD_AGGREGATOR_CONTRACT_ADDRESS}) to spend your tokens.
2.  **Deposit:** Call 'deposit' on the Aggregator (${YIELD_AGGREGATOR_CONTRACT_ADDRESS}) with token address and amount (smallest unit).

Use Beratrail or other tools to interact.`);
});
bot.command('withdrawhelp', (ctx) => {
    ctx.reply(`To withdraw:
1.  Call 'withdraw' on the Aggregator (${YIELD_AGGREGATOR_CONTRACT_ADDRESS}) with token address and amount (smallest unit).

Withdrawals depend on liquidity. Agent may need to rebalance first.`);
});
bot.command('bribehelp', (ctx) => {
    ctx.reply(`Projects - To submit a bribe:
1.  **Approve:** Use your bribe token's contract (e.g., USDC on Berachain) to approve the Bribe Collector (${BRIBE_COLLECTOR_CONTRACT_ADDRESS}) for the bribe amount.
2.  **Submit:** Call 'submitBribe' on the Bribe Collector (${BRIBE_COLLECTOR_CONTRACT_ADDRESS}).
    - \`_projectId\`: Your unique ID (e.g., "BEX_HONEY_WBERA_LP").
    - \`_bribeToken\`: Address of the token (must be accepted).
    - \`_bribeAmount\`: Amount in smallest unit (e.g., 100 USDC = 100000000 if 6 decimals).
    - \`_durationSeconds\`: Duration in seconds (e.g., 7 days = 604800).

The agent detects successful bribes automatically.`);
});
// --- Admin Commands (using viem) ---
// Shared function to handle admin transactions
function sendAdminTx(ctx, // Consider defining a Telegraf context type
contractAddress, abi, functionName, args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!isAdmin(ctx.from.id)) {
            yield ctx.reply('Unauthorized.');
            return;
        }
        try {
            yield ctx.reply(`Simulating ${functionName} transaction...`);
            // Simulate the transaction
            const { request } = yield publicClient.simulateContract({
                address: contractAddress,
                abi: abi,
                functionName: functionName,
                args: args,
                account: agentAccount, // Agent needs to be the owner
            });
            yield ctx.reply(`Simulation successful. Sending transaction...`);
            // Send the transaction
            const hash = yield walletClient.writeContract(request);
            const explorerUrl = (_a = TARGET_CHAIN.blockExplorers) === null || _a === void 0 ? void 0 : _a.default.url;
            const txUrl = explorerUrl ? `${explorerUrl}/tx/${hash}` : `Hash: ${hash}`;
            yield ctx.reply(`Transaction sent: ${txUrl}\nWaiting for confirmation...`);
            // Wait for confirmation
            const receipt = yield publicClient.waitForTransactionReceipt({ hash });
            if (receipt.status === 'success') {
                yield ctx.reply(`✅ Transaction confirmed successfully!\nBlock: ${receipt.blockNumber}`);
                console.log(`${functionName} tx ${hash} confirmed successfully.`);
            }
            else {
                yield ctx.reply(`❌ Transaction failed! Status: ${receipt.status}\nBlock: ${receipt.blockNumber}`);
                console.error(`${functionName} tx ${hash} failed. Status: ${receipt.status}`);
            }
        }
        catch (error) { // Catch unknown for broader compatibility
            console.error(`Error executing ${functionName}:`, error);
            let errorMessage = 'An unknown error occurred.';
            if (error instanceof Error) {
                // Try to extract a useful message from viem errors
                if (error instanceof viem_1.ContractFunctionExecutionError) {
                    errorMessage = `Contract execution failed: ${error.shortMessage}`;
                }
                else {
                    errorMessage = error.message;
                }
            }
            else if (typeof error === 'string') {
                errorMessage = error;
            }
            yield ctx.reply(`Failed to execute ${functionName}: ${errorMessage}`);
        }
    });
}
bot.command('manage_yield_token', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const parts = ctx.message.text.split(' ');
    if (parts.length !== 3 || !['true', 'false'].includes(parts[2])) {
        return ctx.reply('Usage: /manage_yield_token <token_address> <true|false>');
    }
    const [, tokenAddressStr, acceptedStr] = parts;
    if (!(0, viem_1.isAddress)(tokenAddressStr))
        return ctx.reply('Invalid token address format.');
    const tokenAddress = (0, viem_1.getAddress)(tokenAddressStr); // Checksum
    const isAccepted = acceptedStr === 'true';
    yield sendAdminTx(ctx, YIELD_AGGREGATOR_CONTRACT_ADDRESS, yieldAggregatorABI, 'manageAcceptedToken', [tokenAddress, isAccepted]);
}));
bot.command('manage_protocol', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const parts = ctx.message.text.split(' ');
    if (parts.length !== 3) {
        return ctx.reply('Usage: /manage_protocol <protocol_id_string> <protocol_address>');
    }
    const [, protocolId, protocolAddressStr] = parts;
    if (!(0, viem_1.isAddress)(protocolAddressStr))
        return ctx.reply('Invalid protocol address format.');
    const protocolAddress = (0, viem_1.getAddress)(protocolAddressStr);
    yield sendAdminTx(ctx, YIELD_AGGREGATOR_CONTRACT_ADDRESS, yieldAggregatorABI, 'manageProtocol', [protocolId, protocolAddress]);
}));
bot.command('manage_bribe_token', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const parts = ctx.message.text.split(' ');
    if (parts.length !== 3 || !['true', 'false'].includes(parts[2])) {
        return ctx.reply('Usage: /manage_bribe_token <token_address> <true|false>');
    }
    const [, tokenAddressStr, acceptedStr] = parts;
    if (!(0, viem_1.isAddress)(tokenAddressStr))
        return ctx.reply('Invalid token address format.');
    const tokenAddress = (0, viem_1.getAddress)(tokenAddressStr);
    const isAccepted = acceptedStr === 'true';
    yield sendAdminTx(ctx, BRIBE_COLLECTOR_CONTRACT_ADDRESS, bribeCollectorABI, 'manageBribeToken', [tokenAddress, isAccepted]);
}));
// --- Event Listener for Bribes ---
let unwatchBribeEvents = null; // Function to stop the listener
function startBribeListener() {
    if (unwatchBribeEvents) {
        console.log("Stopping existing bribe listener...");
        unwatchBribeEvents(); // Stop previous listener if exists
    }
    console.log(`Starting listener for BribeReceived events on ${BRIBE_COLLECTOR_CONTRACT_ADDRESS}...`);
    try {
        unwatchBribeEvents = publicClient.watchContractEvent({
            address: BRIBE_COLLECTOR_CONTRACT_ADDRESS,
            abi: bribeCollectorABI,
            eventName: 'BribeReceived',
            // strict: true, // Optional: only process logs strictly matching the ABI
            onLogs: (logs) => __awaiter(this, void 0, void 0, function* () {
                console.log(`Received ${logs.length} BribeReceived event(s)`);
                for (const log of logs) {
                    try {
                        // Args are typed based on the ABI now
                        const args = log.args;
                        if (!args || !args.projectId || !args.bribeToken || args.bribeAmount === undefined || args.durationSeconds === undefined || !log.blockNumber) {
                            console.warn("Skipping incomplete BribeReceived event log:", log);
                            continue;
                        }
                        const { projectId, bribeToken, bribeAmount, durationSeconds } = args;
                        const blockNumber = log.blockNumber;
                        console.log(`Processing Bribe: Project=${projectId}, Token=${bribeToken}, Amount=${bribeAmount}, Duration=${durationSeconds}s, Block=${blockNumber}`);
                        // 1. Get Block Timestamp
                        const block = yield publicClient.getBlock({ blockNumber });
                        const blockTimestamp = block.timestamp; // bigint (seconds)
                        const expiryTimestamp = blockTimestamp + durationSeconds; // bigint
                        // 2. Get Token Decimals
                        const decimals = yield getTokenDecimals(bribeToken);
                        // 3. Calculate APY Boost
                        const amountNumber = Number(bribeAmount) / (10 ** decimals);
                        const durationDays = Number(durationSeconds) / 86400; // seconds in a day
                        const apyBoost = durationDays > 0
                            ? (amountNumber / durationDays) * BRIBE_APY_SCALE_FACTOR
                            : 0;
                        if (apyBoost <= 0) {
                            console.warn(`Calculated zero or negative APY boost for bribe ${projectId} (Amount: ${amountNumber}, Duration Days: ${durationDays}). Skipping.`);
                            continue;
                        }
                        console.log(`  Calculated APY Boost: ${apyBoost.toFixed(4)}%`);
                        console.log(`  Expiry Timestamp (Unix): ${expiryTimestamp}`);
                        console.log(`  Expiry Date: ${new Date(Number(expiryTimestamp) * 1000).toISOString()}`);
                        // 4. Store in DB
                        db.run(`INSERT INTO bribes (project_id, apy_boost, expiry_timestamp) VALUES (?, ?, ?)`, [projectId, apyBoost, Number(expiryTimestamp)], // Store expiry as number
                        (err) => {
                            if (err) {
                                console.error(`DB Error storing bribe for ${projectId}:`, err);
                            }
                            else {
                                console.log(`✅ Successfully stored bribe for ${projectId}`);
                            }
                        });
                    }
                    catch (processingError) {
                        console.error("Error processing individual BribeReceived event:", processingError, "Log:", log);
                    }
                } // end for loop over logs
            }),
            onError: (error) => {
                console.error('ERROR in watchContractEvent for Bribes:', error);
                // Basic resilience: try restarting the listener after a delay
                if (unwatchBribeEvents)
                    unwatchBribeEvents();
                unwatchBribeEvents = null; // Allow restart
                console.log("Attempting to restart bribe listener in 15 seconds...");
                setTimeout(startBribeListener, 15000);
            },
            poll: true, // Use polling - WS might be less reliable on some RPCs/networks
            pollingInterval: 8000, // Poll every 8 seconds (adjust as needed)
        });
        console.log("Bribe listener setup complete.");
    }
    catch (listenerError) {
        console.error("CRITICAL: Failed to initialize bribe listener:", listenerError);
        // Consider more robust retry or exit strategy
        console.log("Retrying listener setup in 30 seconds...");
        setTimeout(startBribeListener, 30000);
    }
}
// --- Core Agent Rebalance Logic ---
// Placeholder - Replace with actual token registry management
// Important: Symbols MUST match those used in getSimulatedAPYs
const tokenRegistry = {
    "HONEY": (0, viem_1.getAddress)("0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce"), // Replace with actual Artio HONEY address
    "BERA": (0, viem_1.getAddress)("0x6969696969696969696969696969696969696969"), // Replace with actual Artio WBERA or BERA address
    "HONEY_WBERA_LP": (0, viem_1.getAddress)("0x2c4a603a2aa5596287a06886862dc29d56dbc354") // Replace with actual Artio LP address
};
function runRebalanceCycle() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        console.log(`[${new Date().toISOString()}] --- Starting Rebalance Cycle ---`);
        let rebalanceOccurred = false;
        try {
            const baseAPYs = yield getSimulatedAPYs();
            const activeBribes = yield getActiveBribes(); // { "protocolId": boost, ... }
            // 1. Calculate Effective APYs
            const effectiveAPYs = {};
            console.log("[Data] Base APYs:", JSON.stringify(baseAPYs));
            console.log("[Data] Active Bribes:", JSON.stringify(activeBribes));
            // Iterate through all protocols that have base APYs OR active bribes
            const allProtocolIds = new Set([...Object.keys(baseAPYs), ...Object.keys(activeBribes)]);
            for (const protocolId of allProtocolIds) {
                effectiveAPYs[protocolId] = {};
                const protocolBaseAPYs = baseAPYs[protocolId] || {};
                const bribeBoost = activeBribes[protocolId] || 0;
                // Iterate through all known yield tokens
                for (const tokenSymbol of Object.keys(tokenRegistry)) {
                    const baseAPY = (_a = protocolBaseAPYs[tokenSymbol]) !== null && _a !== void 0 ? _a : 0; // Default base to 0 if not present
                    // Only calculate effective APY if base exists OR there's a bribe for this protocol
                    if (baseAPY > 0 || bribeBoost > 0) {
                        const effective = baseAPY + bribeBoost;
                        effectiveAPYs[protocolId][tokenSymbol] = effective;
                        if (bribeBoost > 0 && baseAPY > 0) { // Log only if both exist
                            console.log(`  Boost Applied: ${protocolId} for ${tokenSymbol}. Base: ${baseAPY.toFixed(4)}%, Boost: ${bribeBoost.toFixed(4)}%, Effective: ${effective.toFixed(4)}%`);
                        }
                        else if (bribeBoost > 0) { // Log if only bribe exists (implies base was 0 or missing)
                            console.log(`  Boost Only: ${protocolId} for ${tokenSymbol}. Boost: ${bribeBoost.toFixed(4)}%, Effective: ${effective.toFixed(4)}%`);
                        }
                    }
                }
            }
            console.log("[Calculation] Effective APYs:", JSON.stringify(effectiveAPYs));
            // 2. Determine Optimal Allocation for each Managed Token
            for (const [tokenSymbol, tokenAddress] of Object.entries(tokenRegistry)) {
                console.log(`\n-- Optimizing for ${tokenSymbol} (${tokenAddress}) --`);
                let bestAPY = -Infinity; // Start lower than 0
                let bestProtocolId = "AGGREGATOR_VAULT"; // Default to keeping liquid
                for (const protocolId in effectiveAPYs) {
                    const currentTokenAPY = (_b = effectiveAPYs[protocolId]) === null || _b === void 0 ? void 0 : _b[tokenSymbol];
                    if (currentTokenAPY !== undefined && currentTokenAPY > bestAPY) {
                        bestAPY = currentTokenAPY;
                        bestProtocolId = protocolId;
                    }
                }
                if (bestAPY <= 0) { // No yield >= 0 found
                    console.log(`  No positive yield found for ${tokenSymbol}. Optimal: AGGREGATOR_VAULT (Liquid).`);
                    bestProtocolId = "AGGREGATOR_VAULT";
                }
                else {
                    console.log(`  Optimal Allocation: ${bestProtocolId} @ ${bestAPY.toFixed(4)}% APY`);
                }
                // 3. Compare with Current On-Chain Allocation & Trigger Rebalance Tx
                let totalTokenBalance;
                let tokenDecimals;
                try {
                    totalTokenBalance = yield publicClient.readContract({
                        address: YIELD_AGGREGATOR_CONTRACT_ADDRESS,
                        abi: yieldAggregatorABI,
                        functionName: 'totalTokenBalances',
                        args: [tokenAddress]
                    });
                    tokenDecimals = yield getTokenDecimals(tokenAddress);
                }
                catch (e) {
                    console.error(`  ERROR: Failed to read total balance/decimals for ${tokenSymbol}. Skipping optimization. Error: ${e.shortMessage || e.message}`);
                    continue; // Skip token
                }
                if (totalTokenBalance === BigInt(0)) {
                    console.log(`  No ${tokenSymbol} balance in vault. Skipping rebalance.`);
                    continue;
                }
                console.log(`  Total Vault Balance: ${(0, viem_1.formatUnits)(totalTokenBalance, tokenDecimals)} ${tokenSymbol}`);
                // Find current allocation (Needs improvement for scale - maybe track off-chain)
                let currentProtocolId = "AGGREGATOR_VAULT";
                let currentAllocation = BigInt(0);
                for (const protoId of allProtocolIds) { // Check all potential protocols
                    try {
                        const allocation = yield publicClient.readContract({
                            address: YIELD_AGGREGATOR_CONTRACT_ADDRESS,
                            abi: yieldAggregatorABI,
                            functionName: 'protocolAllocations',
                            args: [protoId, tokenAddress]
                        });
                        if (allocation > BigInt(0)) {
                            currentProtocolId = protoId;
                            // Assume full allocation to one place for simplicity now
                            // A real vault might split allocations. This logic needs enhancement for that.
                            currentAllocation = totalTokenBalance;
                            break;
                        }
                    }
                    catch (readError) {
                        // Ignore errors here, just means it's not allocated there
                    }
                }
                if (currentProtocolId === "AGGREGATOR_VAULT") {
                    // If loop finished and it's still VAULT, means all funds are liquid
                    currentAllocation = totalTokenBalance;
                }
                console.log(`  Current Allocation: ${(0, viem_1.formatUnits)(currentAllocation, tokenDecimals)} ${tokenSymbol} in ${currentProtocolId}`);
                // 4. Execute Rebalance if Needed
                if (bestProtocolId !== currentProtocolId) {
                    // Amount to move is the entire balance currently in the 'from' location
                    const amountToMove = currentAllocation; // If from VAULT, it's total balance; if from proto, it's that allocation.
                    if (amountToMove > BigInt(0)) {
                        console.log(`  >>> ACTION: Rebalancing ${(0, viem_1.formatUnits)(amountToMove, tokenDecimals)} ${tokenSymbol} from ${currentProtocolId} TO ${bestProtocolId}...`);
                        rebalanceOccurred = true;
                        try {
                            const { request } = yield publicClient.simulateContract({
                                address: YIELD_AGGREGATOR_CONTRACT_ADDRESS,
                                abi: yieldAggregatorABI,
                                functionName: 'rebalance',
                                args: [currentProtocolId, bestProtocolId, tokenAddress, amountToMove],
                                account: agentAccount,
                            });
                            const hash = yield walletClient.writeContract(request);
                            const explorerUrl = (_c = TARGET_CHAIN.blockExplorers) === null || _c === void 0 ? void 0 : _c.default.url;
                            const txUrl = explorerUrl ? `${explorerUrl}/tx/${hash}` : `Hash: ${hash}`;
                            console.log(`    Tx Sent: ${txUrl}. Waiting for confirmation async...`);
                            // Async wait for confirmation - don't block the loop
                            publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
                                .then((receipt) => {
                                if (receipt.status === 'success') {
                                    console.log(`    ✅ Rebalance CONFIRMED for ${tokenSymbol} (${hash}). Block: ${receipt.blockNumber}`);
                                }
                                else {
                                    console.error(`    ❌ Rebalance FAILED for ${tokenSymbol} (${hash}). Status: ${receipt.status}. Block: ${receipt.blockNumber}`);
                                }
                            })
                                .catch(waitErr => {
                                console.error(`    ⚠️ Error waiting for rebalance tx ${hash} confirmation:`, waitErr);
                            });
                        }
                        catch (txError) {
                            console.error(`  ⛔️ ERROR Simulating/Sending Rebalance Tx for ${tokenSymbol}: ${(txError === null || txError === void 0 ? void 0 : txError.shortMessage) || (txError === null || txError === void 0 ? void 0 : txError.message)}`);
                            if (txError.cause)
                                console.error("  -> Cause:", txError.cause);
                        }
                    }
                    else {
                        console.log(`  Skipping rebalance for ${tokenSymbol} - amount to move is zero (should not happen if totalBalance > 0).`);
                    }
                }
                else {
                    console.log(`  No rebalance needed for ${tokenSymbol}. Already optimal in ${currentProtocolId}.`);
                }
            } // End token loop
        }
        catch (error) {
            console.error("Error during rebalance cycle:", error);
        }
        finally {
            console.log(`[${new Date().toISOString()}] --- Rebalance Cycle Finished ${rebalanceOccurred ? '(Rebalances Initiated)' : '(No Rebalances Needed)'} ---`);
        }
    });
}
// --- Bot Launch and Agent Start ---
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Initial connection test
            const blockNumber = yield publicClient.getBlockNumber();
            console.log(`Successfully connected to ${TARGET_CHAIN.name}. Current block: ${blockNumber}`);
            // Start Telegram bot
            yield bot.launch();
            console.log('Telegram bot started successfully.');
            // Start listening for bribe events
            startBribeListener();
            // Run the agent cycle immediately and then on interval
            console.log("Running initial rebalance cycle...");
            yield runRebalanceCycle(); // Run once immediately
            console.log(`Starting periodic rebalance cycle every ${REBALANCE_INTERVAL_MS / 1000 / 60} minutes.`);
            setInterval(runRebalanceCycle, REBALANCE_INTERVAL_MS);
        }
        catch (error) {
            console.error("CRITICAL: Failed to initialize agent:", error);
            process.exit(1);
        }
    });
}
// Graceful shutdown handler
const shutdown = (signal) => {
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
        }
        else {
            console.log("Database connection closed.");
            process.exit(0);
        }
    });
    // Force exit after a timeout if DB close hangs
    setTimeout(() => {
        console.error("Forcing shutdown after timeout.");
        process.exit(1);
    }, 5000); // 5 seconds grace period
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Start the main application logic
main().catch(error => {
    console.error("Unhandled error during agent startup:", error);
    process.exit(1);
});
