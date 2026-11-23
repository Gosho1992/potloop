// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev 6-decimal test stablecoin standing in for QUSDC in local tests.
contract MockUSD is ERC20 {
    constructor() ERC20("Mock QUSDC", "mQUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Burns 1% on every transfer, to prove the circle rejects short transfers.
contract FeeOnTransferUSD is ERC20 {
    constructor() ERC20("Fee USD", "FUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

interface ICircle {
    function accept() external;
    function contribute() external;
    function withdraw() external;
}

/// @dev Token that calls back into the circle while paying out, to prove withdraw() cannot be re-entered.
contract ReentrantUSD is ERC20 {
    address public circle;
    address public attacker;

    constructor() ERC20("Reentrant USD", "RUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address circle_, address attacker_) external {
        circle = circle_;
        attacker = attacker_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == circle && to == attacker && attacker != address(0)) {
            AttackerMember(attacker).reenter();
        }
    }
}

/// @dev A circle member that tries to withdraw a second time from inside the payout transfer.
contract AttackerMember {
    ICircle public circle;
    ERC20 public token;
    bool public tried;

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

    function withdraw() external {
        circle.withdraw();
    }

    function reenter() external {
        if (tried) return;
        tried = true;
        circle.withdraw(); // must fail
    }
}

interface ISweep {
    function sweepSurplus() external;
}

/// @dev Calls the circle's sweepSurplus() from inside a payout, BEFORE balances move, to prove
///      cross-function reentrancy (withdraw -> sweepSurplus) is blocked.
contract SweepCallbackUSD is ERC20 {
    address public circle;

    constructor() ERC20("Sweep USD", "SUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address circle_) external {
        circle = circle_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == circle && circle != address(0)) ISweep(circle).sweepSurplus();
        super._update(from, to, value);
    }
}

/// @dev Stablecoin with an issuer blacklist (like many real stablecoins).
contract BlacklistUSD is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blacklist USD", "BUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from] && !blocked[to], "blocked");
        super._update(from, to, value);
    }
}

/// @dev Takes a 1% fee only on transfers out of `feeFrom` (an outbound-only fee).
contract OutboundFeeUSD is ERC20 {
    address public feeFrom;

    constructor() ERC20("Outbound fee USD", "OUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeFrom(address a) external {
        feeFrom = a;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == feeFrom && feeFrom != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
