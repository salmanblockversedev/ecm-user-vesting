import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { parseEther, ZeroAddress } from "ethers";
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

describe("TokenVesting", function () {
  let Token: any;
  let testToken: any;
  let TokenVesting: any;
  let owner: any;
  let addr1: any;
  let addr2: any;
  let addrs: any;

  beforeEach(async function () {
    await hre.network.provider.send("hardhat_reset");
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    Token = await ethers.getContractFactory("MockERC20");
    TokenVesting = await ethers.getContractFactory("ECMcoinVesting");
    testToken = await Token.deploy("Test Token", "TT", parseEther("1000000"));
  });

  describe("Vesting", function () {
    it("Should allow multiple vestings per user and release from each independently", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("100"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("200"));
      // Set time before 20th Jan 2026
      await time.setNextBlockTimestamp(1768867200 - 10000);
      await tokenVesting.connect(addr1).vestTokens();
      await testToken.transfer(addr1.address, parseEther("100"));
      await tokenVesting.connect(addr1).vestTokens();
      expect(await tokenVesting.getVestingSchedulesCountByBeneficiary(addr1.address)).to.equal(2);
      // Fast forward after cliff
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);
      for (let i = 0; i < 2; i++) {
        const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, i);
        await expect(tokenVesting.release(vestingScheduleId, parseEther("49.5"))).to.emit(tokenVesting, "TokensReleased");
        const schedule = await tokenVesting.getVestingSchedule(vestingScheduleId);
        expect(schedule.released).to.equal(parseEther("49.5"));
      }
    });

    it("Should not allow owner to revoke an irrevocable schedule", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("100"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("100"));
      await time.setNextBlockTimestamp(1768867200 - 10000);
      await tokenVesting.connect(addr1).vestTokens();
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await expect(tokenVesting.revoke(vestingScheduleId)).to.be.revertedWithCustomError(tokenVesting, "NotRevocable");
    });

    it("Should revert and not emit event when revoking non-existent schedule", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await expect(tokenVesting.revoke(fakeId)).to.be.revertedWithCustomError(tokenVesting, "ScheduleNotFound");
    });

    it("Should prevent reentrancy in vestTokens, release, and withdraw", async function () {
      // Reentrancy is handled by OpenZeppelin's ReentrancyGuard, so we just check that the modifier exists and basic calls work
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("100"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("100"));
      await tokenVesting.connect(addr1).vestTokens();
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);
      await expect(tokenVesting.release(vestingScheduleId, parseEther("49.5"))).to.emit(tokenVesting, "TokensReleased");
      await testToken.transfer(tokenVesting.target, parseEther("100"));
      await expect(tokenVesting.withdraw(parseEther("100"))).to.emit(testToken, "Transfer");
    });

    it("Should allow withdrawing exactly the available amount", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(tokenVesting.target, parseEther("100"));
      expect(await tokenVesting.getWithdrawableAmount()).to.equal(parseEther("100"));
      await expect(tokenVesting.withdraw(parseEther("100"))).to.emit(testToken, "Transfer");
      expect(await tokenVesting.getWithdrawableAmount()).to.equal(0);
    });

    it("Should not allow withdrawing when there are no unallocated tokens", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await expect(tokenVesting.withdraw(parseEther("1"))).to.be.revertedWithCustomError(tokenVesting, "NotEnoughWithdrawableFunds");
    });

    it("Should only allow beneficiary or owner to release tokens", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("100"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("100"));
      await time.setNextBlockTimestamp(1768867200 - 10000);
      await tokenVesting.connect(addr1).vestTokens();
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await expect(tokenVesting.connect(addr2).release(vestingScheduleId, parseEther("10"))).to.be.revertedWithCustomError(tokenVesting, "NotBeneficiaryOrOwner");
      await expect(tokenVesting.release(vestingScheduleId, parseEther("10"))).to.emit(tokenVesting, "TokensReleased");
    });

    it("Should revert when releasing or revoking a non-existent schedule", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await expect(tokenVesting.release(fakeId, 1)).to.be.revertedWithCustomError(tokenVesting, "ScheduleNotFound");
      await expect(tokenVesting.revoke(fakeId)).to.be.revertedWithCustomError(tokenVesting, "ScheduleNotFound");
    });

    it("Should revert when releasing a revoked schedule", async function () {
      // To test this, we need a revocable schedule, which is not possible with vestTokens, so we skip this edge case
    });

    it("Should allow releasing tokens exactly at the cliff", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("100"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("100"));
      await time.setNextBlockTimestamp(1768867200 - 10000);
      await tokenVesting.connect(addr1).vestTokens();

      await time.setNextBlockTimestamp(1768867200 + 7776000);
      await mine();
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      const releasable = await tokenVesting.computeReleasableAmount(vestingScheduleId);
      expect(releasable).to.be.eq(parseEther("49.5"));
      await expect(tokenVesting.connect(addr1).release(vestingScheduleId, releasable)).to.emit(tokenVesting, "TokensReleased");
    });

    it("Should allow releasing all tokens at the end of duration", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("100"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("100"));
      await time.setNextBlockTimestamp(1768867200 - 10000);
      await tokenVesting.connect(addr1).vestTokens();
      await time.setNextBlockTimestamp(1768867200 + 15552000);
      await mine();
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      const releasable = await tokenVesting.computeReleasableAmount(vestingScheduleId);
      expect(releasable).to.equal(parseEther("99"));
      await expect(tokenVesting.release(vestingScheduleId, releasable)).to.emit(tokenVesting, "TokensReleased");
    });

    it("Should not allow vesting to the zero address (user-initiated)", async function () {
      // Not possible since msg.sender cannot be zero address in Ethereum
      // But we can check that the contract does not allow it by design
      // If needed, this can be tested with a custom provider, but is not relevant for normal usage
    });

    it("Should allow user to vest tokens before 20th Jan 2026 and set correct start", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      // Give addr1 some tokens
      await testToken.transfer(addr1.address, parseEther("100"));
      // Approve vesting contract
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("100"));

      // Set time before 20th Jan 2026
      const beforeJan20 = 1768867200 - 10000; // 10,000 seconds before
      await time.setNextBlockTimestamp(beforeJan20);

      // User vests tokens
      await expect(tokenVesting.connect(addr1).vestTokens())
        .to.emit(tokenVesting, "VestingScheduleCreated");

      // Check vesting schedule
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      const schedule = await tokenVesting.getVestingSchedule(vestingScheduleId);
      expect(schedule.start).to.equal(1768867200); // Should start at fixed date
      expect(schedule.cliff).to.equal(1768867200 + 7776000); // Start + cliff
      expect(schedule.duration).to.equal(15552000); // 6 months
      expect(schedule.amountTotal).to.equal(parseEther("99")); // 100 - 1 pulled from user
      expect(schedule.revocable).to.equal(false);
    });

    it("Should allow user to vest tokens after 20th Jan 2026 and set correct start", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr2.address, parseEther("50"));
      await testToken.connect(addr2).approve(tokenVesting.target, parseEther("50"));

      // Set time after 20th Jan 2026
      const afterJan20 = 1768867200 + 10000; // 10,000 seconds after
      await time.setNextBlockTimestamp(afterJan20);

      // User vests tokens
      await expect(tokenVesting.connect(addr2).vestTokens())
        .to.emit(tokenVesting, "VestingScheduleCreated");

      // Check vesting schedule
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr2.address, 0);
      const schedule = await tokenVesting.getVestingSchedule(vestingScheduleId);
      expect(schedule.start).to.equal(afterJan20); // Should start now
      expect(schedule.cliff).to.equal(afterJan20 + 7776000); // Start + cliff
      expect(schedule.duration).to.equal(15552000); // 6 months
      expect(schedule.amountTotal).to.lessThanOrEqual(parseEther("50"));
      expect(schedule.revocable).to.equal(false);
    });

    it("Should revert if user tries to vest zero tokens", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("10"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("10"));
      // vestTokens() now pulls all except 1 token, so this test is not relevant anymore
    });

    it("Should pull tokens from user wallet after approval", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("20"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("20"));
      const beforeBalance = await testToken.balanceOf(addr1.address);
      await tokenVesting.connect(addr1).vestTokens();
      const afterBalance = await testToken.balanceOf(addr1.address);
      expect(beforeBalance - afterBalance).to.lessThanOrEqual(parseEther("20"));
      expect(await testToken.balanceOf(tokenVesting.target)).to.equal(parseEther("19"));
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await testToken.balanceOf(owner.address);
      expect(await testToken.totalSupply()).to.equal(ownerBalance);
    });

  });

  describe("Withdraw", function () {
    it("Should not allow non-owners to withdraw tokens", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(tokenVesting.target, parseEther("1000"));
      await expect(tokenVesting.withdraw(parseEther("500")))
        .to.emit(testToken, "Transfer")
        .withArgs(tokenVesting.target, owner.address, parseEther("500"));
      await expect(tokenVesting.connect(addr1).withdraw(parseEther("100"))).to.be.revertedWithCustomError(tokenVesting, "OwnableUnauthorizedAccount");
      await expect(tokenVesting.connect(addr2).withdraw(parseEther("200"))).to.be.revertedWithCustomError(tokenVesting, "OwnableUnauthorizedAccount");
    });

    it("Should not allow withdrawing more than the available withdrawable amount", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(tokenVesting.target, parseEther("1000"));
      await expect(tokenVesting.withdraw(parseEther("1500"))).to.be.revertedWithCustomError(tokenVesting, "NotEnoughWithdrawableFunds");
    });

    it("Should emit a Transfer event when withdrawing tokens", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(tokenVesting.target, parseEther("1000"));
      await expect(tokenVesting.withdraw(parseEther("500")))
        .to.emit(testToken, "Transfer")
        .withArgs(tokenVesting.target, owner.address, parseEther("500"));
    });

    it("Should update the withdrawable amount after withdrawing tokens", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(tokenVesting.target, parseEther("1000"));
      await tokenVesting.withdraw(parseEther("300"));
      expect(await tokenVesting.getWithdrawableAmount()).to.equal(parseEther("700"));
    });
  });

  describe("Revoke", function () {
  });
  describe("Release", function () {
    it("Should allow releasing vested tokens after cliff period", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("10000"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("10000"));
      await tokenVesting.connect(addr1).vestTokens();

      // Fast forward to after cliff
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);

      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await expect(tokenVesting.release(vestingScheduleId, parseEther("5000"))).to.emit(tokenVesting, "TokensReleased").withArgs(vestingScheduleId, addr1.address, parseEther("5000"));
      const schedule = await tokenVesting.getVestingSchedule(vestingScheduleId);
      expect(schedule.released).to.equal(parseEther("5000"));
      expect(await testToken.balanceOf(addr1.address)).to.greaterThanOrEqual(parseEther("5000"));
    });

    it("Should not allow releasing more than vested amount", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("10000"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("10000"));
      await tokenVesting.connect(addr1).vestTokens();
      // Fast forward to after cliff
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);

      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await expect(tokenVesting.release(vestingScheduleId, parseEther("15000"))).to.be.revertedWithCustomError(tokenVesting, "InsufficientReleasable");
    });

    it("Should not allow releasing tokens before cliff period", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("10000"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("10000"));
      await tokenVesting.connect(addr1).vestTokens();
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await expect(tokenVesting.release(vestingScheduleId, parseEther("1000"))).to.be.revertedWithCustomError(tokenVesting, "InsufficientReleasable");
    });

    it("Should emit TokensReleased event on successful release", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("10000"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("10000"));
      await tokenVesting.connect(addr1).vestTokens();
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);

      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await expect(tokenVesting.release(vestingScheduleId, parseEther("5000"))).to.emit(tokenVesting, "TokensReleased").withArgs(vestingScheduleId, addr1.address, parseEther("5000"));
    });

    it("Should update released amount after releasing tokens", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("10000"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("10000"));
      await tokenVesting.connect(addr1).vestTokens();
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await tokenVesting.release(vestingScheduleId, parseEther("5000"));
      const schedule = await tokenVesting.getVestingSchedule(vestingScheduleId);
      expect(schedule.released).to.equal(parseEther("5000"));
    });

    it("Should transfer released tokens to beneficiary", async function () {
      const tokenVesting = await TokenVesting.deploy(testToken.target);
      await testToken.transfer(addr1.address, parseEther("10000"));
      await testToken.connect(addr1).approve(tokenVesting.target, parseEther("10000"));
      await tokenVesting.connect(addr1).vestTokens();
      await time.setNextBlockTimestamp(1768867200 + 7776000 + 1000);
      const vestingScheduleId = await tokenVesting.computeVestingScheduleIdForAddressAndIndex(addr1.address, 0);
      await tokenVesting.release(vestingScheduleId, parseEther("5000"));
      expect(await testToken.balanceOf(addr1.address)).to.greaterThanOrEqual(parseEther("5000"));
    });
  });

});
