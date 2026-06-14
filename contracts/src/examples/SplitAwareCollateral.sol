// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ICorporateActionRegistry } from "../interfaces/ICorporateActionRegistry.sol";
import { ActionType, CorporateAction } from "../libraries/CorporateActionTypes.sol";
import { SplitAdjuster } from "../libraries/SplitAdjuster.sol";

/// @title SplitAwareCollateral
/// @author Parvalon
/// @notice Reference integration showing how a lending market / collateral oracle
///         consumes a Parvalon `STOCK_SPLIT` signal to keep its valuation correct.
///         Without this, a 4-for-1 split would silently 4× the share count while
///         the protocol still priced each share at the pre-split level — a real,
///         systemic mispricing of tokenized-stock collateral.
/// @dev The registry confirms the action *type* on-chain; the numeric ratio comes
///      from the action's off-chain metadata (parsed by the keeper) and is applied
///      idempotently. This is illustrative integration code, not a full money market.
contract SplitAwareCollateral {
    ICorporateActionRegistry public immutable REGISTRY;
    address public keeper;

    /// @notice Oracle price per share for each asset (1e18-scaled).
    mapping(address asset => uint256 pricePerShare) public price;
    /// @notice Guards against applying the same split action twice.
    mapping(uint256 actionId => bool applied) public applied;

    event KeeperSet(address indexed keeper);
    event PriceSet(address indexed asset, uint256 pricePerShare);
    event SplitApplied(
        uint256 indexed actionId, address indexed asset, uint256 newShares, uint256 oldShares, uint256 newPrice
    );

    error NotKeeper();
    error NotASplit(uint256 actionId);
    error AlreadyApplied(uint256 actionId);
    error ZeroAddress();

    constructor(address registry, address keeper_) {
        if (registry == address(0) || keeper_ == address(0)) revert ZeroAddress();
        REGISTRY = ICorporateActionRegistry(registry);
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    function setKeeper(address keeper_) external onlyKeeper {
        if (keeper_ == address(0)) revert ZeroAddress();
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setPrice(address asset, uint256 pricePerShare) external onlyKeeper {
        price[asset] = pricePerShare;
        emit PriceSet(asset, pricePerShare);
    }

    /// @notice Apply the split signaled by registry action `actionId`. The registry
    ///         confirms it is a `STOCK_SPLIT`; the keeper supplies the ratio read
    ///         from the action metadata. Forward 4-for-1 → `(newShares=4, oldShares=1)`.
    function applySplit(uint256 actionId, uint256 newShares, uint256 oldShares) external onlyKeeper {
        CorporateAction memory a = REGISTRY.getAction(actionId);
        if (a.actionType != ActionType.STOCK_SPLIT) revert NotASplit(actionId);
        if (applied[actionId]) revert AlreadyApplied(actionId);
        applied[actionId] = true;

        SplitAdjuster.SplitRatio memory r = SplitAdjuster.SplitRatio({ newShares: newShares, oldShares: oldShares });
        uint256 newPrice = SplitAdjuster.adjustPrice(price[a.asset], r);
        price[a.asset] = newPrice;
        emit SplitApplied(actionId, a.asset, newShares, oldShares, newPrice);
    }
}
