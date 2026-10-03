// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {PeachEx} from "../src/PeachEx.sol";
import {PeachExGenesis} from "../src/PeachExGenesis.sol";

contract NFTTreasury is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract PeachExTest is Test {
    uint256 internal treasuryKey = 0xA11CE;
    address internal treasury;
    address internal alice = address(0xBEEF);
    PeachEx internal token;

    function setUp() public {
        treasury = vm.addr(treasuryKey);
        token = new PeachEx(treasury);
    }

    function testMetadata() public view {
        assertEq(token.name(), "PeachEx");
        assertEq(token.symbol(), "PCHX");
        assertEq(token.decimals(), 18);
        assertEq(token.ISSUER(), unicode"Rötter Robotics");
    }

    function testInitialSupplyMintedOnceToTreasury() public view {
        assertEq(token.totalSupply(), 100_000_000 ether);
        assertEq(token.balanceOf(treasury), 100_000_000 ether);
    }

    function testZeroTreasuryReverts() public {
        vm.expectRevert(PeachEx.ZeroTreasury.selector);
        new PeachEx(address(0));
    }

    function testTransferWorks() public {
        vm.prank(treasury);
        token.transfer(alice, 25 ether);
        assertEq(token.balanceOf(alice), 25 ether);
    }

    function testHolderCanBurnOwnTokens() public {
        vm.startPrank(treasury);
        token.transfer(alice, 10 ether);
        vm.stopPrank();
        vm.prank(alice);
        token.burn(4 ether);
        assertEq(token.balanceOf(alice), 6 ether);
        assertEq(token.totalSupply(), 99_999_996 ether);
    }

    function testPermit() public {
        address spender = address(0xCAFE);
        uint256 value = 123 ether;
        uint256 deadline = block.timestamp + 1 days;
        uint256 nonce = token.nonces(treasury);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                treasury,
                spender,
                value,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(treasuryKey, digest);
        token.permit(treasury, spender, value, deadline, v, r, s);
        assertEq(token.allowance(treasury, spender), value);
        assertEq(token.nonces(treasury), nonce + 1);
    }

    function testContractURIIsDataURI() public view {
        assertTrue(bytes(token.contractURI()).length > 100);
        assertTrue(_startsWith(token.contractURI(), "data:application/json;base64,"));
    }

    function _startsWith(string memory value, string memory prefix) internal pure returns (bool) {
        bytes memory a = bytes(value);
        bytes memory b = bytes(prefix);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; ++i) if (a[i] != b[i]) return false;
        return true;
    }
}

contract PeachExGenesisTest is Test {
    NFTTreasury internal treasury;
    PeachEx internal token;
    PeachExGenesis internal genesis;

    function setUp() public {
        treasury = new NFTTreasury();
        token = new PeachEx(address(treasury));
        genesis = new PeachExGenesis(address(treasury), address(token));
    }

    function testGenesisMintedExactlyOnce() public view {
        assertEq(genesis.ownerOf(1), address(treasury));
        assertEq(genesis.balanceOf(address(treasury)), 1);
    }

    function testGenesisReferencesToken() public view {
        assertEq(genesis.token(), address(token));
    }

    function testGenesisMetadataIsDataURI() public view {
        assertTrue(bytes(genesis.tokenURI(1)).length > 100);
        assertTrue(bytes(genesis.contractURI()).length > 100);
    }

    function testNonexistentGenesisReverts() public {
        vm.expectRevert();
        genesis.tokenURI(2);
    }

    function testZeroAddressReverts() public {
        vm.expectRevert(PeachExGenesis.ZeroAddress.selector);
        new PeachExGenesis(address(0), address(token));

        vm.expectRevert(PeachExGenesis.ZeroAddress.selector);
        new PeachExGenesis(address(treasury), address(0));
    }
}
