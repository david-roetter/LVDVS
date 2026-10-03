// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PeachEx} from "../src/PeachEx.sol";
import {PeachExGenesis} from "../src/PeachExGenesis.sol";
import {PeachExChronicleAnchor} from "../src/PeachExChronicleAnchor.sol";

contract Deploy is Script {
    function run() external returns (PeachEx token, PeachExGenesis genesis, PeachExChronicleAnchor anchor) {
        require(block.chainid == 11155111 || block.chainid == 31337, "Only Sepolia or local test chain");
        address treasury = vm.envAddress("TREASURY");
        require(treasury.code.length > 0 || block.chainid == 31337, "TREASURY should be a Safe (contract)");

        vm.startBroadcast();
        token = new PeachEx(treasury);
        genesis = new PeachExGenesis(treasury, address(token));
        anchor = new PeachExChronicleAnchor(address(token));
        vm.stopBroadcast();

        console.log("PeachEx (PCHX):  ", address(token));
        console.log("PeachEx Genesis: ", address(genesis));
        console.log("Treasury:        ", treasury);
        console.log("Chronicle anchor:", address(anchor));
        console.logBytes32(keccak256(address(token).code));
        console.logBytes32(keccak256(address(anchor).code));
    }
}
