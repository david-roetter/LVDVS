// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

library PeachArt {
    string internal constant COLOR = "#FB7456";
    string internal constant BACKGROUND = "#FFF4EC";
    string internal constant PATH =
        "M785 95C766 105 745 110 700 116C646 123 623 128 597 141C547 165 512 208 500 259C498 266 498 294 500 299L501 302L507 298C526 285 547 278 586 272C620 267 632 265 652 259C720 238 764 195 785 127C788 118 794 89 793 90C793 90 789 92 785 95ZM373 287C371 287 367 287 363 288C258 300 168 379 131 492C83 638 149 774 303 849C322 858 350 870 362 873C363 873 368 875 373 877C378 878 391 882 403 885C414 888 429 893 436 895C498 914 527 915 574 898C599 889 623 882 639 877C730 848 805 792 849 721C918 611 880 451 764 363C694 310 595 294 538 326C533 329 532 329 543 338C593 378 624 447 625 524C627 582 613 623 568 693C538 741 527 768 524 800C522 822 527 851 536 867C539 874 537 872 533 864C522 845 517 828 517 804C516 765 523 739 556 674C593 600 601 568 598 518C591 409 537 325 457 298C433 289 394 284 373 287Z";

    function logoSVG() internal pure returns (string memory) {
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000'>",
            "<path fill='", COLOR, "' d='", PATH, "'/></svg>"
        );
    }

    function genesisSVG() internal pure returns (string memory) {
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000'>",
            "<rect width='1000' height='1000' fill='", BACKGROUND, "'/>",
            "<g transform='translate(150 110) scale(.7)'><path fill='", COLOR, "' d='", PATH, "'/></g>",
            "<text x='500' y='890' text-anchor='middle' font-family='Helvetica,Arial,sans-serif' ",
            "font-size='54' font-weight='700' letter-spacing='6' fill='#3B2A24'>PEACHEX</text>",
            "<text x='500' y='940' text-anchor='middle' font-family='Helvetica,Arial,sans-serif' ",
            "font-size='26' letter-spacing='4' fill='#8A6E62'>GENESIS &#183; R&#214;TTER ROBOTICS</text></svg>"
        );
    }

    function svgDataURI(string memory svg) internal pure returns (string memory) {
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    function jsonDataURI(string memory json) internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
