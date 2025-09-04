pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";
/**
 * @title ECMcoinVesting
 */
contract ECMcoinVesting is Ownable, ReentrancyGuard {
    // Custom errors
    error InsufficientTokens();
    error ZeroAddressBeneficiary();
    error DurationMustBePositive();
    error AmountMustBePositive();
    error DurationMustBeGreaterThanCliff();
    error ScheduleNotFound();
    error ScheduleRevoked();
    error NotRevocable();
    error NotEnoughWithdrawableFunds();
    error NotBeneficiaryOrOwner();
    error InsufficientReleasable();
    using SafeERC20 for IERC20;

    struct VestingSchedule {
        address beneficiary;
        uint256 cliff;
        uint256 start;
        uint256 duration;
        bool revocable;
        uint256 amountTotal;
        uint256 released;
        bool revoked;
    }

    // Events
    event VestingScheduleCreated(
        bytes32 indexed vestingScheduleId,
        address indexed beneficiary,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        bool revocable,
        uint256 amount
    );
    event TokensReleased(
        bytes32 indexed vestingScheduleId,
        address indexed beneficiary,
        uint256 amount
    );
    event VestingScheduleRevoked(bytes32 indexed vestingScheduleId);
    event Withdraw(address indexed to, uint256 amount);

    // Constants for user vesting
    uint256 public constant USER_VESTING_START_TIMESTAMP = 1768867200; // 20th Jan 2026, 00:00:00 UTC
    uint256 public constant USER_VESTING_CLIFF = 7776000; // 3 months in seconds
    uint256 public constant USER_VESTING_DURATION = 15552000; // 6 months in seconds

    // address of the ERC20 token
    IERC20 private immutable _token;
    bytes32[] private vestingSchedulesIds;
    mapping(bytes32 => VestingSchedule) private vestingSchedules;
    uint256 private vestingSchedulesTotalAmount;
    mapping(address => uint256) private holdersVestingCount;

    modifier onlyIfVestingScheduleExists(bytes32 id) {
        if (vestingSchedules[id].beneficiary == address(0))
            revert ScheduleNotFound();
        _;
    }
    /**
     * @dev Reverts if the vesting schedule does not exist or has been revoked.
     */
    modifier onlyIfVestingScheduleNotRevoked(bytes32 vestingScheduleId) {
        if (vestingSchedules[vestingScheduleId].revoked)
            revert ScheduleRevoked();
        _;
    }

    /**
     * @dev Creates a vesting contract.
     * @param token_ address of the ERC20 token contract
     */
    constructor(address token_) Ownable(msg.sender) {
        // Check that the token address is not 0x0.
        require(token_ != address(0));
        // Set the token address.
        _token = IERC20(token_);
    }

    /**
     * @notice Allows a user to vest their own tokens. Contract pulls tokens from user after approval.
     * @param amount Amount of tokens to vest
     */
    function vestTokens(uint256 amount) external nonReentrant {
        if (amount == 0) revert AmountMustBePositive();
        address beneficiary = msg.sender;
        // Pull tokens from user
        _token.safeTransferFrom(beneficiary, address(this), amount);

        // Determine vesting start and cliff
        uint256 currentTime = getCurrentTime();
        uint256 start;
        if (currentTime < USER_VESTING_START_TIMESTAMP) {
            // Vesting starts at fixed date for early users
            start = USER_VESTING_START_TIMESTAMP;
        } else {
            // Vesting starts now for late users
            start = currentTime;
        }
        uint256 cliff = USER_VESTING_CLIFF;
        uint256 duration = USER_VESTING_DURATION;

        // Create vesting schedule (irrevocable)
        bytes32 vestingScheduleId = computeNextVestingScheduleIdForHolder(
            beneficiary
        );
        uint256 cliffAbs = start + cliff;
        vestingSchedules[vestingScheduleId] = VestingSchedule(
            beneficiary,
            cliffAbs,
            start,
            duration,
            false, // irrevocable
            amount,
            0,
            false
        );
        vestingSchedulesTotalAmount += amount;
        vestingSchedulesIds.push(vestingScheduleId);
        holdersVestingCount[beneficiary] += 1;
        emit VestingScheduleCreated(
            vestingScheduleId,
            beneficiary,
            start,
            cliffAbs,
            duration,
            false,
            amount
        );
    }

    /**
     * @dev This function is called for plain Ether transfers, i.e. for every call with empty calldata.
     */
    receive() external payable {}

    /**
     * @dev Fallback function is executed if none of the other functions match the function
     * identifier or no data was provided with the function call.
     */
    fallback() external payable {}

    /**
     * @notice Revokes the vesting schedule for given identifier.
     * @param vestingScheduleId the vesting schedule identifier
     */
    function revoke(
        bytes32 vestingScheduleId
    )
        external
        onlyOwner
        onlyIfVestingScheduleExists(vestingScheduleId)
        onlyIfVestingScheduleNotRevoked(vestingScheduleId)
    {
        VestingSchedule storage vestingSchedule = vestingSchedules[
            vestingScheduleId
        ];
        if (!vestingSchedule.revocable) revert NotRevocable();
        uint256 vestedAmount = _computeReleasableAmount(vestingSchedule);
        if (vestedAmount > 0) {
            release(vestingScheduleId, vestedAmount);
        }
        uint256 unreleased = vestingSchedule.amountTotal -
            vestingSchedule.released;
        vestingSchedulesTotalAmount -= unreleased;
        vestingSchedule.revoked = true;
        emit VestingScheduleRevoked(vestingScheduleId);
    }

    /**
     * @notice Withdraw the specified amount if possible.
     * @param amount the amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant onlyOwner {
        if (getWithdrawableAmount() < amount)
            revert NotEnoughWithdrawableFunds();
        _token.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    /**
     * @notice Release vested amount of tokens.
     * @param vestingScheduleId the vesting schedule identifier
     * @param amount the amount to release
     */
    function release(
        bytes32 vestingScheduleId,
        uint256 amount
    )
        public
        nonReentrant
        onlyIfVestingScheduleExists(vestingScheduleId)
        onlyIfVestingScheduleNotRevoked(vestingScheduleId)
    {
        VestingSchedule storage vestingSchedule = vestingSchedules[
            vestingScheduleId
        ];
        if (
            !(msg.sender == vestingSchedule.beneficiary ||
                msg.sender == owner())
        ) revert NotBeneficiaryOrOwner();
        uint256 releasable = _computeReleasableAmount(vestingSchedule);
        console.log("Releasable amount:", releasable);
        if (!(releasable >= amount && amount > 0))
            revert InsufficientReleasable();
        vestingSchedule.released += amount;
        vestingSchedulesTotalAmount -= amount;
        _token.safeTransfer(vestingSchedule.beneficiary, amount);
        emit TokensReleased(
            vestingScheduleId,
            vestingSchedule.beneficiary,
            amount
        );
    }

    /**
     * @dev Returns the number of vesting schedules associated to a beneficiary.
     * @return the number of vesting schedules
     */
    function getVestingSchedulesCountByBeneficiary(
        address _beneficiary
    ) external view returns (uint256) {
        return holdersVestingCount[_beneficiary];
    }

    /**
     * @dev Returns the vesting schedule id at the given index.
     * @return the vesting id
     */
    function getVestingIdAtIndex(
        uint256 index
    ) external view returns (bytes32) {
        require(
            index < getVestingSchedulesCount(),
            "TokenVesting: index out of bounds"
        );
        return vestingSchedulesIds[index];
    }

    /**
     * @notice Returns the vesting schedule information for a given holder and index.
     * @return the vesting schedule structure information
     */
    function getVestingScheduleByAddressAndIndex(
        address holder,
        uint256 index
    ) external view returns (VestingSchedule memory) {
        return
            getVestingSchedule(
                computeVestingScheduleIdForAddressAndIndex(holder, index)
            );
    }

    /**
     * @notice Returns the total amount of vesting schedules.
     * @return the total amount of vesting schedules
     */
    function getVestingSchedulesTotalAmount() external view returns (uint256) {
        return vestingSchedulesTotalAmount;
    }

    /**
     * @dev Returns the address of the ERC20 token managed by the vesting contract.
     */
    function getToken() external view returns (address) {
        return address(_token);
    }

    /**
     * @dev Returns the number of vesting schedules managed by this contract.
     * @return the number of vesting schedules
     */
    function getVestingSchedulesCount() public view returns (uint256) {
        return vestingSchedulesIds.length;
    }

    /**
     * @notice Computes the vested amount of tokens for the given vesting schedule identifier.
     * @return the vested amount
     */
    function computeReleasableAmount(
        bytes32 vestingScheduleId
    )
        external
        view
        onlyIfVestingScheduleExists(vestingScheduleId)
        onlyIfVestingScheduleNotRevoked(vestingScheduleId)
        returns (uint256)
    {
        VestingSchedule storage vestingSchedule = vestingSchedules[
            vestingScheduleId
        ];
        return _computeReleasableAmount(vestingSchedule);
    }

    /**
     * @notice Returns the vesting schedule information for a given identifier.
     * @return the vesting schedule structure information
     */
    function getVestingSchedule(
        bytes32 vestingScheduleId
    ) public view returns (VestingSchedule memory) {
        return vestingSchedules[vestingScheduleId];
    }

    /**
     * @dev Returns the amount of tokens that can be withdrawn by the owner.
     * @return the amount of tokens
     */
    function getWithdrawableAmount() public view returns (uint256) {
        return _token.balanceOf(address(this)) - vestingSchedulesTotalAmount;
    }

    /**
     * @dev Computes the next vesting schedule identifier for a given holder address.
     */
    function computeNextVestingScheduleIdForHolder(
        address holder
    ) public view returns (bytes32) {
        return
            computeVestingScheduleIdForAddressAndIndex(
                holder,
                holdersVestingCount[holder]
            );
    }

    /**
     * @dev Returns the last vesting schedule for a given holder address.
     */
    function getLastVestingScheduleForHolder(
        address holder
    ) external view returns (VestingSchedule memory) {
        return
            vestingSchedules[
                computeVestingScheduleIdForAddressAndIndex(
                    holder,
                    holdersVestingCount[holder] - 1
                )
            ];
    }

    /**
     * @dev Computes the vesting schedule identifier for an address and an index.
     */
    function computeVestingScheduleIdForAddressAndIndex(
        address holder,
        uint256 index
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(holder, index));
    }

    /**
     * @dev Computes the releasable amount of tokens for a vesting schedule.
     * @return the amount of releasable tokens
     */
    function _computeReleasableAmount(
        VestingSchedule memory vestingSchedule
    ) internal view returns (uint256) {
        uint256 currentTime = getCurrentTime();
        if ((currentTime < vestingSchedule.cliff) || vestingSchedule.revoked) {
            return 0;
        }
        if (currentTime >= vestingSchedule.start + vestingSchedule.duration) {
            return vestingSchedule.amountTotal - vestingSchedule.released;
        }
        uint256 timeFromStart = currentTime - vestingSchedule.start;
        uint256 vestedAmount = (vestingSchedule.amountTotal * timeFromStart) /
            vestingSchedule.duration;
        return vestedAmount - vestingSchedule.released;
    }

    /**
     * @dev Returns the current time.
     * @return the current timestamp in seconds.
     */
    function getCurrentTime() internal view virtual returns (uint256) {
        return block.timestamp;
    }
}
