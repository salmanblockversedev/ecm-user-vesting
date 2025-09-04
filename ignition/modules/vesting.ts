
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "ethers";

const ECMcoinVesting_Module = buildModule("ECMCoinVesting_Module", (m) => {
  // const ecmToken =  m.contract("MockERC20", ["TestToken", "TT", parseEther("1000000")]);
  const ecmToken = m.getParameter("ecmToken", "0x4C324169890F42c905f3b8f740DBBe7C4E5e55C0");
  // --- Deploy ECMcoinVesting implementation ---

  const ecmcoinVesting = m.contract("ECMcoinVesting", [ecmToken]);

  // --- Parameters for ECMCoinICO ---

  return { ecmcoinVesting };
});

export default ECMcoinVesting_Module;