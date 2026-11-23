// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {SavingsCircle} from "./SavingsCircle.sol";

/// @title CircleDeployer
/// @notice Holds SavingsCircle's creation code so CircleFactory stays far below the 24,576-byte
///         runtime limit. It is created by the factory in the factory's own constructor, records
///         that factory as its only caller, and has no owner, no settings and no other function.
///         Nobody else can deploy circles through it, so the factory's rules (minimum cover,
///         minimum round length, token, fee) cannot be bypassed here, and only circles the factory
///         asked for are ever registered by it.
contract CircleDeployer {
    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    function deploy(SavingsCircle.Config calldata cfg) external returns (address) {
        if (msg.sender != factory) revert NotFactory();
        return address(new SavingsCircle(cfg));
    }
}
