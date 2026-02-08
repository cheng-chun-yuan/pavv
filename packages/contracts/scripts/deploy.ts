import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  // 1a. Deploy ZKTranscriptLib (library required by HonkVerifier)
  console.log("\nDeploying ZKTranscriptLib...");
  const TranscriptLib = await ethers.getContractFactory("ZKTranscriptLib");
  const transcriptLib = await TranscriptLib.deploy();
  await transcriptLib.waitForDeployment();
  const transcriptLibAddr = await transcriptLib.getAddress();
  console.log("ZKTranscriptLib deployed to:", transcriptLibAddr);

  // 1b. Deploy HonkVerifier (linked with ZKTranscriptLib)
  console.log("\nDeploying HonkVerifier...");
  const Verifier = await ethers.getContractFactory("HonkVerifier", {
    libraries: {
      "contracts/Verifier.sol:ZKTranscriptLib": transcriptLibAddr,
    },
  });
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log("HonkVerifier deployed to:", verifierAddr);

  // 2. Deploy BLSGun with verifier address
  console.log("\nDeploying BLSGun...");
  const BLSGun = await ethers.getContractFactory("BLSGun");
  const blsgun = await BLSGun.deploy(verifierAddr);
  await blsgun.waitForDeployment();
  const blsgunAddr = await blsgun.getAddress();
  console.log("BLSGun deployed to:", blsgunAddr);

  // 3. Fund the contract with 10 ETH via shield() with a dummy commitment
  console.log("\nFunding BLSGun with 10 ETH via shield()...");
  const dummyCommitment = ethers.keccak256(ethers.toUtf8Bytes("demo-deposit"));
  const tx = await blsgun.shield(dummyCommitment, {
    value: ethers.parseEther("10"),
  });
  await tx.wait();

  const contractBalance = await ethers.provider.getBalance(blsgunAddr);
  console.log("BLSGun balance:", ethers.formatEther(contractBalance), "ETH");

  // 4. Write deployment addresses to JSON
  const deployment = {
    chainId: 31337,
    verifier: verifierAddr,
    blsgun: blsgunAddr,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, "localhost.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment saved to:", outPath);

  console.log("\n--- Deployment Summary ---");
  console.log("HonkVerifier:", verifierAddr);
  console.log("BLSGun:      ", blsgunAddr);
  console.log("Balance:     ", ethers.formatEther(contractBalance), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
