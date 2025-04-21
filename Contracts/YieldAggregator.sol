// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // Import Ownable
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


/**
 * @title YieldAggregator
 * @dev Manages user deposits and allocates funds to underlying protocols based on off-chain agent decisions.
 * Assumes underlying protocols handle yield generation and auto-compounding.
 * Rebalancing logic is controlled by the owner (the off-chain agent).
 * For simplicity, actual interaction with underlying protocols is simulated via events.
 */
contract YieldAggregator is Ownable {
    using SafeERC20 for IERC20;

    // ----- State Variables -----

    // Mapping from token address to whether it's accepted for deposits
    mapping(address => bool) public acceptedTokens;

    // Mapping from a unique protocol identifier (e.g., "ProjectX_Pool") to its main contract address (or pool address)
    // In reality, you might need more info like deposit/withdraw function selectors
    mapping(string => address) public underlyingProtocols;

    // Tracks individual user balances for each accepted token (funds held by this contract before allocation)
    // userAddress => tokenAddress => amount
    mapping(address => mapping(address => uint256)) public userBalances;

    // Tracks total balance of each token held by this contract (liquid + allocated)
    // tokenAddress => amount
    mapping(address => uint256) public totalTokenBalances;

    // Tracks allocated balance of each token to each underlying protocol
    // protocolId => tokenAddress => amount
    mapping(string => mapping(address => uint256)) public protocolAllocations;

    // ----- Events -----

    event TokenAccepted(address indexed token, bool isAccepted);
    event ProtocolAdded(string indexed protocolId, address indexed protocolAddress);
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Rebalanced(
        address indexed agent,
        string fromProtocolId, // Can be "AGGREGATOR_VAULT" if moving from liquid
        string toProtocolId,   // Can be "AGGREGATOR_VAULT" if moving to liquid
        address indexed token,
        uint256 amount
    );
    event Harvested( // Optional: If agent needs to trigger harvests
        address indexed agent,
        string indexed protocolId,
        address indexed rewardToken,
        uint256 amount
    );

    // ----- Constructor -----

    // Owner is set automatically by Ownable's constructor
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ----- Owner Functions -----

    /**
     * @dev Add or remove an ERC20 token from the list of accepted deposit tokens.
     * @param _token The address of the ERC20 token.
     * @param _isAccepted True to accept, false to remove.
     */
    function manageAcceptedToken(address _token, bool _isAccepted) external onlyOwner {
        require(_token != address(0), "YieldAggregator: Invalid token address");
        acceptedTokens[_token] = _isAccepted;
        emit TokenAccepted(_token, _isAccepted);
    }

    /**
     * @dev Add or update the address associated with an underlying protocol.
     * @param _protocolId A unique string identifier for the protocol (e.g., "HONEY_FARM").
     * @param _protocolAddress The main interaction address for the protocol.
     */
    function manageProtocol(string calldata _protocolId, address _protocolAddress) external onlyOwner {
        require(bytes(_protocolId).length > 0, "YieldAggregator: Protocol ID cannot be empty");
        // Basic check, might want stricter address validation
        require(_protocolAddress != address(0), "YieldAggregator: Invalid protocol address");
        underlyingProtocols[_protocolId] = _protocolAddress;
        emit ProtocolAdded(_protocolId, _protocolAddress);
    }

    /**
     * @dev Moves funds between the aggregator's internal balance and underlying protocols, or between protocols.
     * This function SIMULATES the movement by updating internal accounting and emitting an event.
     * Real implementation requires interacting with the underlying protocol's contracts (deposit/withdraw/stake/unstake).
     * @param _fromProtocolId The identifier of the protocol to move funds FROM ("AGGREGATOR_VAULT" for liquid funds).
     * @param _toProtocolId The identifier of the protocol to move funds TO ("AGGREGATOR_VAULT" for liquid funds).
     * @param _token The address of the token being moved.
     * @param _amount The amount of the token to move.
     */
    function rebalance(
        string memory _fromProtocolId,
        string memory _toProtocolId,
        address _token,
        uint256 _amount
    ) external onlyOwner {
        require(acceptedTokens[_token], "YieldAggregator: Token not accepted");
        require(_amount > 0, "YieldAggregator: Amount must be positive");
        require(keccak256(bytes(_fromProtocolId)) != keccak256(bytes(_toProtocolId)), "YieldAggregator: From/To protocols are the same");

        // --- Simulate Withdraw from Source ---
        if (keccak256(bytes(_fromProtocolId)) != keccak256(bytes("AGGREGATOR_VAULT"))) {
            // Moving from an external protocol
            require(underlyingProtocols[_fromProtocolId] != address(0), "YieldAggregator: From protocol not found");
            require(protocolAllocations[_fromProtocolId][_token] >= _amount, "YieldAggregator: Insufficient funds in from protocol");
            protocolAllocations[_fromProtocolId][_token] -= _amount;

            // TODO - REAL IMPLEMENTATION:
            // Call withdraw/unstake function on underlyingProtocols[_fromProtocolId]
            // Ensure the funds (_amount) are transferred back to this contract.
            // Example: IProtocol(underlyingProtocols[_fromProtocolId]).withdraw(_token, _amount);
        } else {
            // Moving from liquid funds held directly by this contract
            // Check if enough liquid funds exist (Total Balance - Total Allocated Externally)
            uint256 totalAllocatedExternally = 0;
            // This is inefficient - better to store liquid balance directly if needed often
            // In this simplified model, we just check totalTokenBalances conceptually represents enough supply
             require(totalTokenBalances[_token] >= _amount, "YieldAggregator: Insufficient total balance for rebalance");
             // We don't decrease userBalances here, just the conceptual liquid portion
        }

         // --- Simulate Deposit to Destination ---
        if (keccak256(bytes(_toProtocolId)) != keccak256(bytes("AGGREGATOR_VAULT"))) {
             // Moving to an external protocol
            require(underlyingProtocols[_toProtocolId] != address(0), "YieldAggregator: To protocol not found");
            protocolAllocations[_toProtocolId][_token] += _amount;

            // TODO - REAL IMPLEMENTATION:
            // Approve the underlying protocol to spend the token
            // IERC20(_token).safeApprove(underlyingProtocols[_toProtocolId], _amount);
            // Call deposit/stake function on underlyingProtocols[_toProtocolId]
            // Example: IProtocol(underlyingProtocols[_toProtocolId]).deposit(_token, _amount);
             // Handle potential approval race conditions or use safeApprove/increaseAllowance patterns.
        } else {
            // Moving back to liquid funds held by this contract
            // No specific state change needed here, funds are conceptually liquid now.
        }

        emit Rebalanced(msg.sender, _fromProtocolId, _toProtocolId, _token, _amount);
    }

     // Optional: Function for the agent to trigger harvesting rewards if underlying protocols don't auto-compound
     function harvest(string memory _protocolId, address _rewardToken) external onlyOwner {
         require(underlyingProtocols[_protocolId] != address(0), "YieldAggregator: Protocol not found");

         // TODO - REAL IMPLEMENTATION:
         // Call the claim/harvest function on underlyingProtocols[_protocolId]
         // Example: uint256 rewardAmount = IProtocol(underlyingProtocols[_protocolId]).claimRewards();
         // Transfer rewardAmount of _rewardToken to this contract or reinvest directly.
         uint256 rewardAmount = 0; // Placeholder

         emit Harvested(msg.sender, _protocolId, _rewardToken, rewardAmount);

         // Optionally, immediately rebalance the harvested rewards
         // if (rewardAmount > 0 && acceptedTokens[_rewardToken]) {
         //     rebalance("AGGREGATOR_VAULT", "BEST_APY_PROTOCOL", _rewardToken, rewardAmount);
         // }
     }


    // ----- Public User Functions -----

    /**
     * @dev Deposit accepted tokens into the aggregator.
     * @param _token The address of the ERC20 token to deposit.
     * @param _amount The amount to deposit.
     */
    function deposit(address _token, uint256 _amount) external {
        require(acceptedTokens[_token], "YieldAggregator: Token not accepted");
        require(_amount > 0, "YieldAggregator: Deposit amount must be positive");

        userBalances[msg.sender][_token] += _amount;
        totalTokenBalances[_token] += _amount;

        // Transfer tokens from user to this contract
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        emit Deposited(msg.sender, _token, _amount);

        // Note: The agent is responsible for allocating these deposited funds later via rebalance.
    }

    /**
     * @dev Withdraw tokens from the aggregator.
     * Assumes sufficient funds are available either as liquid balance or can be recalled by the agent.
     * @param _token The address of the ERC20 token to withdraw.
     * @param _amount The amount to withdraw.
     */
    function withdraw(address _token, uint256 _amount) external {
        require(acceptedTokens[_token], "YieldAggregator: Token not accepted");
        require(_amount > 0, "YieldAggregator: Withdraw amount must be positive");
        require(userBalances[msg.sender][_token] >= _amount, "YieldAggregator: Insufficient balance");

        // Check if the contract has enough overall balance (liquid + allocated)
        require(totalTokenBalances[_token] >= _amount, "YieldAggregator: Insufficient total liquidity in contract");

        // TODO - REAL IMPLEMENTATION: Need robust liquidity management.
        // If IERC20(_token).balanceOf(address(this)) < _amount, the agent MUST trigger
        // rebalance calls to pull funds back from underlying protocols BEFORE this withdrawal
        // can fully succeed. This simplified version assumes funds are available or agent manages it proactively.

        userBalances[msg.sender][_token] -= _amount;
        totalTokenBalances[_token] -= _amount;

        // Transfer tokens from this contract to the user
        IERC20(_token).safeTransfer(msg.sender, _amount);

        emit Withdrawn(msg.sender, _token, _amount);
    }

    // ----- View Functions -----

    /**
     * @dev Get the total allocated amount of a token in a specific protocol.
     */
    function getAllocatedBalance(string memory _protocolId, address _token) public view returns (uint256) {
        return protocolAllocations[_protocolId][_token];
    }

     /**
      * @dev Get the user's balance for a specific token.
      */
    function getUserBalance(address _user, address _token) public view returns (uint256) {
        return userBalances[_user][_token];
    }

    // Add other view functions as needed (e.g., get total value locked)

    // --- Receive Function ---
    // Optional: Allow receiving native currency (e.g., ETH) if needed,
    // perhaps to wrap it into WETH for deposit. Requires more logic.
    // receive() external payable {
    //     // Handle received ETH
    // }
}