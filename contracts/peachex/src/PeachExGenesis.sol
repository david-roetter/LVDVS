// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {PeachArt} from "./PeachArt.sol";

contract PeachExGenesis is ERC721 {
    uint256 public constant GENESIS_ID = 1;
    address public immutable token;
    error ZeroAddress();

    constructor(address treasury, address token_) ERC721("PeachEx Genesis", "PCHXG") {
        if (treasury == address(0) || token_ == address(0)) revert ZeroAddress();
        token = token_;
        _safeMint(treasury, GENESIS_ID);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return PeachArt.jsonDataURI(
            string.concat(
                '{"name":"PeachEx Genesis #1",',
                '"description":"The genesis 1/1 of PeachEx by R\\u00f6tter Robotics. ',
                'The asset everyone checks out. Artwork stored fully on-chain.",',
                '"image":"', PeachArt.svgDataURI(PeachArt.genesisSVG()), '",',
                '"attributes":[',
                '{"trait_type":"Issuer","value":"R\\u00f6tter Robotics"},',
                '{"trait_type":"Edition","value":"1/1"},',
                '{"trait_type":"PCHX Token","value":"', Strings.toHexString(token), '"}',
                "]}"
            )
        );
    }

    function contractURI() external pure returns (string memory) {
        return PeachArt.jsonDataURI(
            string.concat(
                '{"name":"PeachEx Genesis",',
                '"description":"Genesis 1/1 of PeachEx by R\\u00f6tter Robotics. Bottom line: PCHX.",',
                '"image":"', PeachArt.svgDataURI(PeachArt.logoSVG()), '"}'
            )
        );
    }
}
