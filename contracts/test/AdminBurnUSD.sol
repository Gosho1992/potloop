// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test only. Models the QUSDC administrator power found on QIE mainnet: an account holding
///      the vault role can burn tokens from ANY address without an allowance (QUSDC.burn(from, amount)).
contract AdminBurnUSD is ERC20 {
    address public immutable admin;

    constructor() ERC20("Admin-burnable USD", "aUSD") {
        admin = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == admin, "not admin");
        _burn(from, amount);
    }
}
