# MeowFi Yield Aggregator Agent (Mantle Sepolia)

## Overview

This script implements an automated agent for managing a DeFi yield aggregator protocol deployed on the Mantle Sepolia testnet. The agent monitors market conditions (simulated APYs and received bribes), calculates optimal yield strategies, and automatically rebalances funds between different underlying DeFi protocols to maximize returns. It also provides a Telegram bot interface for users to check status and for administrators to manage the protocol.

## Features

*   **Automated Rebalancing:** Periodically evaluates yield opportunities across configured protocols and rebalances funds to the highest-yielding option.
*   **Bribe Integration:** Listens for `BribeReceived` events from a dedicated [`BribeCollector`](Contracts/BribeCollector.sol) contract, calculates the corresponding APY boost, and factors it into rebalancing decisions.
*   **Telegram Bot Interface:**
    *   `/status`: Displays current vault allocations and total balances.
    *   `/deposithelp`, `/withdrawhelp`, `/bribehelp`: Provides instructions for interacting with the contracts.
    *   Admin commands (`/manage_yield_token`, `/manage_protocol`, `/manage_bribe_token`) for protocol configuration.
*   **On-Chain Interaction:** Uses `viem` to interact with the Mantle Sepolia network, read contract states, and send transactions.
*   **Persistent Bribe Storage:** Uses an SQLite database to store active bribe details and cache token decimals.
*   **Configuration via Environment:** Sensitive keys, contract addresses, and RPC URLs are managed through a [`.env`](.env) file.

## Architecture

1.  **Configuration & Setup:** Loads environment variables, defines the target blockchain ([`TARGET_CHAIN`](src/agent.ts) - Mantle Sepolia), and sets up `viem` public and wallet clients ([`publicClient`](src/agent.ts), [`walletClient`](src/agent.ts)).
2.  **Database:** Initializes an SQLite database connection ([`db`](src/agent.ts)) and creates tables for `bribes` and `token_decimals` if they don't exist.
3.  **Telegram Bot:** Initializes a `telegraf` bot instance ([`bot`](src/agent.ts)) and defines handlers for user and admin commands.
4.  **Bribe Listener:** Uses [`publicClient.watchContractEvent`](src/agent.ts) to listen for `BribeReceived` events on the [`BRIBE_COLLECTOR_CONTRACT_ADDRESS`](src/agent.ts). When an event is detected ([`startBribeListener`](src/agent.ts)):
    *   Fetches block timestamp.
    *   Calculates the bribe's expiry timestamp.
    *   Fetches the bribe token's decimals (using [`getTokenDecimals`](src/agent.ts), which includes DB caching).
    *   Calculates the `apy_boost` based on the amount, duration, and [`BRIBE_APY_SCALE_FACTOR`](src/agent.ts).
    *   Stores the `project_id`, `apy_boost`, and `expiry_timestamp` in the `bribes` table.
5.  **Rebalancing Cycle (`runRebalanceCycle`):** This core logic runs periodically (every [`REBALANCE_INTERVAL_MS`](src/agent.ts)):
    *   Fetches simulated base APYs ([`getSimulatedAPYs`](src/agent.ts)).
    *   Fetches active bribe boosts from the database ([`getActiveBribes`](src/agent.ts)).
    *   Calculates the *effective APY* for each token in each protocol by adding the base APY and any active bribe boost.
    *   For each managed token in [`tokenRegistry`](src/agent.ts):
        *   Determines the protocol with the highest effective APY (`bestProtocolId`).
        *   Reads the current total balance and allocation of the token from the [`YieldAggregator`](Contracts/YieldAggregator.sol) contract.
        *   If the optimal protocol (`bestProtocolId`) differs from the current one (`currentProtocolId`), it simulates and sends a `rebalance` transaction using the [`agentAccount`](src/agent.ts) via the [`walletClient`](src/agent.ts).
6.  **Helper Functions:** Includes utilities like [`getTokenDecimals`](src/agent.ts) (fetches/caches decimals) and [`isAdmin`](src/agent.ts) (checks Telegram user ID).
7.  **Main Execution (`main`):** Initializes clients, starts the Telegram bot, starts the bribe listener, and initiates the rebalancing cycle interval.
8.  **Graceful Shutdown:** Handles `SIGINT` and `SIGTERM` signals to stop the bot, listener, and close the database connection cleanly.

## Setup

1.  **Clone the repository.**
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Create a `.env` file:** Copy the structure from the example and fill in your specific details.
4.  **Compile TypeScript:**
    ```bash
    # Directly using tsc based on tsconfig.json
    npx tsc
    ```
