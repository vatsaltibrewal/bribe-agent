// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BribeCollector is Ownable {
    using SafeERC20 for IERC20;

    mapping(address => bool) public acceptedBribeTokens;
    address public bribeRecipient;

    event BribeTokenManaged(address indexed token, bool isAccepted);
    event BribeRecipientChanged(address indexed newRecipient);
    event BribeReceived(
        string indexed projectId,
        address indexed bribeToken,
        uint256 bribeAmount,
        uint256 durationSeconds,
        address indexed payer
    );
    event BribesWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    constructor(address initialOwner, address initialBribeRecipient) Ownable(initialOwner) {
        require(initialBribeRecipient != address(0), "BribeCollector: Invalid recipient address");
        bribeRecipient = initialBribeRecipient;
    }

    function manageBribeToken(address _token, bool _isAccepted) external onlyOwner {
        require(_token != address(0), "BribeCollector: Invalid token address");
        acceptedBribeTokens[_token] = _isAccepted;
        emit BribeTokenManaged(_token, _isAccepted);
    }

    function setBribeRecipient(address _newRecipient) external onlyOwner {
        require(_newRecipient != address(0), "BribeCollector: Invalid recipient address");
        bribeRecipient = _newRecipient;
        emit BribeRecipientChanged(_newRecipient);
    }

    function withdrawBribes(address _token) external onlyOwner {
        require(acceptedBribeTokens[_token], "BribeCollector: Token not accepted for bribes");
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "BribeCollector: No balance to withdraw");

        IERC20(_token).safeTransfer(bribeRecipient, balance);
        emit BribesWithdrawn(_token, bribeRecipient, balance);
    }

    function submitBribe(
        string memory _projectId,
        address _bribeToken,
        uint256 _bribeAmount,
        uint256 _durationSeconds
    ) external {
        require(acceptedBribeTokens[_bribeToken], "BribeCollector: Bribe token not accepted");
        require(bytes(_projectId).length > 0, "BribeCollector: Project ID cannot be empty");
        require(_bribeAmount > 0, "BribeCollector: Bribe amount must be positive");
        require(_durationSeconds > 0, "BribeCollector: Duration must be positive");

        IERC20(_bribeToken).safeTransferFrom(msg.sender, address(this), _bribeAmount);

        emit BribeReceived(_projectId, _bribeToken, _bribeAmount, _durationSeconds, msg.sender);
    }
}