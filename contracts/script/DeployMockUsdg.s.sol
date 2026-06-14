// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

/// @title DeployMockUsdg
/// @author Parvalon
/// @notice Deploys a faucet-mintable 6-decimal mock USDG to a testnet and mints a
///         large supply to the issuer. On Robinhood Chain (46630) the REAL USDG
///         faucet is rate-limited (~100/24h), which is too little to fund a
///         meaningful multi-holder dividend — this mock is the payout/settlement
///         token used for testing while the *stock* tokens stay real. The mock has
///         an open `mint`, so the dApp /faucet (and any tester) can self-serve.
///
/// @dev Env:
///   PRIVATE_KEY   deployer/issuer key (required)
///   ISSUER_ADDRESS  mint recipient (default = deployer)
///   USDG_MINT     whole-USDG amount to mint (default 100,000,000)
///
/// Run (Arbitrum Orbit needs a large gas multiplier; explorer verify is separate):
///   forge script script/DeployMockUsdg.s.sol:DeployMockUsdg \
///     --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --broadcast --slow \
///     --gas-estimate-multiplier 400 -vvv
contract DeployMockUsdg is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address issuer = vm.envOr("ISSUER_ADDRESS", vm.addr(pk));
        uint256 whole = vm.envOr("USDG_MINT", uint256(100_000_000));
        uint256 amount = whole * 1e6; // USDG is 6 decimals

        vm.startBroadcast(pk);
        MockERC20 usdg = new MockERC20("USD for Global (Parvalon testnet)", "USDG", 6);
        usdg.mint(issuer, amount);
        vm.stopBroadcast();

        console2.log("MockUSDG (6dp):", address(usdg));
        console2.log("Minted USDG   :", whole);
        console2.log("To issuer     :", issuer);
    }
}
