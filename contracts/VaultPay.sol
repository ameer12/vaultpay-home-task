// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VaultPay
/// @notice Escrow-style ERC20 payment contract.
contract VaultPay is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PaymentStatus {
        None,
        Created,
        Claimed,
        Cancelled
    }

    struct Payment {
        address payer;
        address recipient;
        uint256 amount;
        uint64 createdAt;
        uint64 deadline;
        PaymentStatus status;
        bytes32 memoHash;
    }

    IERC20 public immutable token;
    uint256 public nextPaymentId = 1;

    mapping(uint256 paymentId => Payment payment) private payments;

    event PaymentCreated(
        uint256 indexed paymentId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        uint64 deadline,
        bytes32 memoHash
    );
    event PaymentClaimed(uint256 indexed paymentId, address indexed recipient, uint256 amount);
    event PaymentCancelled(uint256 indexed paymentId, address indexed payer, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidDeadline();
    error PaymentNotFound();
    error PaymentNotActive();
    error NotRecipient();
    error NotPayer();
    error PaymentExpired();
    error PaymentNotExpired();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// @notice Create an escrowed ERC20 payment.
    function createPayment(
        address recipient,
        uint256 amount,
        uint64 deadline,
        bytes32 memoHash
    ) external nonReentrant returns (uint256 paymentId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        paymentId = nextPaymentId++;
        payments[paymentId] = Payment({
            payer: msg.sender,
            recipient: recipient,
            amount: amount,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            status: PaymentStatus.Created,
            memoHash: memoHash
        });

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit PaymentCreated(paymentId, msg.sender, recipient, amount, deadline, memoHash);
    }

    /// @notice Claim an active payment.
    function claimPayment(uint256 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        if (p.status == PaymentStatus.None) revert PaymentNotFound();
        if (p.status != PaymentStatus.Created) revert PaymentNotActive();
        if (msg.sender != p.recipient) revert NotRecipient();
        if (block.timestamp > p.deadline) revert PaymentExpired();

        p.status = PaymentStatus.Claimed;

        token.safeTransfer(p.recipient, p.amount);

        emit PaymentClaimed(paymentId, p.recipient, p.amount);
    }

    /// @notice Cancel an expired payment and refund payer.
    function cancelPayment(uint256 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        if (p.status == PaymentStatus.None) revert PaymentNotFound();
        if (p.status != PaymentStatus.Created) revert PaymentNotActive();
        if (msg.sender != p.payer) revert NotPayer();
        if (block.timestamp <= p.deadline) revert PaymentNotExpired();

        p.status = PaymentStatus.Cancelled;

        token.safeTransfer(p.payer, p.amount);

        emit PaymentCancelled(paymentId, p.payer, p.amount);
    }

    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        return payments[paymentId];
    }
}