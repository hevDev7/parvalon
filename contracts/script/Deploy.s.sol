// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CorporateActionRegistry } from "../src/CorporateActionRegistry.sol";
import { DividendDistributor } from "../src/DividendDistributor.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { AdminActionSource } from "../src/oracle/AdminActionSource.sol";
import { Script, console2 } from "forge-std/Script.sol";

/// @title Deploy
/// @notice Deploys the Parvalon protocol and writes an address registry to
///         `/deployments/<chainId>.json`. Works in two modes, chosen per token by
///         environment:
///           - REAL mode:  pass an existing token address (Robinhood Chain TSLA/AMZN/USDG).
///           - MOCK mode:  omit it and a {MockERC20} faucet token is deployed
///                         (Arbitrum Sepolia fallback / local anvil).
///
/// @dev Required env:
///        PRIVATE_KEY            deployer key (broadcaster)
///      Optional env:
///        ADMIN_ADDRESS          governance/multisig (default: broadcaster)
///        ISSUER_ADDRESS         per-asset issuer (default: broadcaster)
///        AUTO_ATTEST            "true"/"false" — D3 source mode. Default: FALSE
///                               (fail-closed). `true` opens the provenance gate and
///                               is permitted ONLY on known local/testnet chains
///                               (31337 / 421614 / 46630); it reverts elsewhere.
///        USDG_ADDRESS           real USDG (else mock deployed, 18 dec)
///        TSLA_ADDRESS           real TSLA (else mock deployed, 18 dec)
///        AMZN_ADDRESS           real AMZN (else mock deployed, 18 dec)
contract Deploy is Script {
    function run() external {
        address broadcaster = vm.addr(vm.envUint("PRIVATE_KEY"));
        address admin = vm.envOr("ADMIN_ADDRESS", broadcaster);
        address issuer = vm.envOr("ISSUER_ADDRESS", broadcaster);
        // Fail-closed default: a deployer must explicitly opt into auto-attest, and
        // even then only on a known local/testnet chain. This prevents accidentally
        // shipping an open provenance gate (any issuer can announce any action with
        // no off-chain vouch) to a production / real-value deployment.
        bool autoAttest = vm.envOr("AUTO_ATTEST", false);
        if (autoAttest) {
            uint256 cid = block.chainid;
            bool devOrTestnet = cid == 31_337 || cid == 421_614 || cid == 46_630;
            require(devOrTestnet, "AUTO_ATTEST=true forbidden off testnet; set AUTO_ATTEST=false for real value");
            console2.log("!! WARNING AUTO_ATTEST=true: provenance gate OPEN (testnet/demo only). chainId", cid);
        }

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // On the real-token Robinhood chain the payout currency MUST be the real
        // 6-decimal USDG — refuse to silently deploy an 18-dec mock and mis-pay.
        if (block.chainid == 46_630) {
            require(vm.envOr("USDG_ADDRESS", address(0)) != address(0), "USDG_ADDRESS (real 6-dec) required on 46630");
        }

        // --- Payout + underlying assets (real or mock) ---
        address usdg = _resolveToken("USDG_ADDRESS", "USD for Global", "USDG", 18);
        address tsla = _resolveToken("TSLA_ADDRESS", "Tesla Tokenized Stock", "TSLA", 18);
        address amzn = _resolveToken("AMZN_ADDRESS", "Amazon Tokenized Stock", "AMZN", 18);

        // --- Protocol ---
        AdminActionSource source = new AdminActionSource(admin, autoAttest);
        CorporateActionRegistry registry = new CorporateActionRegistry(admin, address(source));
        DividendDistributor distributor = new DividendDistributor(address(registry), admin);

        // Wire the distributor as the only lifecycle authority.
        registry.grantRole(registry.DISTRIBUTOR_ROLE(), address(distributor));

        // Onboard the issuer for every provided asset (admin == broadcaster path).
        if (admin == broadcaster) {
            registry.setAssetIssuer(tsla, issuer);
            registry.setAssetIssuer(amzn, issuer);
            // Additional real stocks (no mock fallback): onboarded only when provided.
            _onboardIfSet(registry, "PLTR_ADDRESS", issuer);
            _onboardIfSet(registry, "NFLX_ADDRESS", issuer);
            _onboardIfSet(registry, "AMD_ADDRESS", issuer);
        }

        vm.stopBroadcast();

        _writeDeployment(address(registry), address(distributor), address(source), usdg, tsla, amzn, admin, issuer);

        console2.log("=== Parvalon deployed on chain", block.chainid, "===");
        console2.log("registry    ", address(registry));
        console2.log("distributor ", address(distributor));
        console2.log("actionSource", address(source));
        console2.log("autoAttest  ", source.autoAttest()); // false in production; verify before going live
        console2.log("usdg        ", usdg);
        console2.log("tsla        ", tsla);
        console2.log("amzn        ", amzn);
    }

    /// @dev Onboards `issuer` for the asset at env var `key`, if one is provided.
    function _onboardIfSet(CorporateActionRegistry registry, string memory key, address issuer) internal {
        address asset = vm.envOr(key, address(0));
        if (asset != address(0)) registry.setAssetIssuer(asset, issuer);
    }

    /// @dev Returns the env-provided token, or deploys a mint-faucet mock.
    function _resolveToken(string memory key, string memory name, string memory symbol, uint8 decimals)
        internal
        returns (address token)
    {
        token = vm.envOr(key, address(0));
        if (token == address(0)) {
            token = address(new MockERC20(name, symbol, decimals));
            console2.log(string.concat("  deployed mock ", symbol), token);
        }
    }

    function _writeDeployment(
        address registry,
        address distributor,
        address source,
        address usdg,
        address tsla,
        address amzn,
        address admin,
        address issuer
    ) internal {
        string memory o = "corporaX";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "registry", registry);
        vm.serializeAddress(o, "distributor", distributor);
        vm.serializeAddress(o, "actionSource", source);
        vm.serializeAddress(o, "usdg", usdg);
        vm.serializeAddress(o, "tsla", tsla);
        vm.serializeAddress(o, "amzn", amzn);
        vm.serializeAddress(o, "admin", admin);
        string memory json = vm.serializeAddress(o, "issuer", issuer);

        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
