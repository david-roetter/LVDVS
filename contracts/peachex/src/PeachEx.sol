// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {PeachArt} from "./PeachArt.sol";

contract PeachEx is ERC20, ERC20Permit, ERC20Burnable {
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10 ** 18;
    string public constant ISSUER = unicode"Rötter Robotics";
    error ZeroTreasury();

    constructor(address treasury) ERC20("PeachEx", "PCHX") ERC20Permit("PeachEx") {
        if (treasury == address(0)) revert ZeroTreasury();
        _mint(treasury, INITIAL_SUPPLY);
    }

    function contractURI() external pure returns (string memory) {
        return PeachArt.jsonDataURI(
            string.concat(
                '{"name":"PeachEx","symbol":"PCHX",',
                '"description":"PeachEx (PCHX) by R\\u00f6tter Robotics. Solid roots. Cheeky assets. ',
                'Initial supply: 100,000,000 PCHX, minted once at deployment. Holders may burn tokens. No owner, no minting, no pausing, no blacklist.",',
                '"issuer":"R\\u00f6tter Robotics",',
                '"image":"', PeachArt.svgDataURI(PeachArt.logoSVG()), '"}'
            )
        );
    }
}
