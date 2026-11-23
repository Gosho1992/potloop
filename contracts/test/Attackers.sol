// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReceiveHook {
    function onTokenReceived() external;
}

interface ICircle {
    function accept() external;
    function contribute() external;
    function withdraw() external;
}

/// @dev Token that calls back into the receiver on every transfer, like an ERC777-style hook.
///      Used only to prove withdraw() cannot be re-entered.
contract HookUSD is ERC20 {
    constructor() ERC20("Hook USD", "HUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to.code.length > 0) {
            try IReceiveHook(to).onTokenReceived() {} catch {}
        }
    }
}

/// @dev A circle member that tries to withdraw twice by re-entering from the token hook.
contract ReentrantMember is IReceiveHook {
    ICircle public circle;
    ERC20 public token;
    bool public attacking;
    bool public reentrySucceeded;
    uint256 public reentryAttempts;

    function setUp(address circle_, address token_) external {
        circle = ICircle(circle_);
        token = ERC20(token_);
    }

    function approveAndAccept(uint256 amount) external {
        token.approve(address(circle), amount);
        circle.accept();
    }

    function approveAndContribute(uint256 amount) external {
        token.approve(address(circle), amount);
        circle.contribute();
    }

    function attackWithdraw() external {
        attacking = true;
        circle.withdraw();
        attacking = false;
    }

    function onTokenReceived() external override {
        if (!attacking || msg.sender != address(token)) return;
        reentryAttempts += 1;
        try circle.withdraw() {
            reentrySucceeded = true;
        } catch {}
    }
}
