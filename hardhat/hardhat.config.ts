import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import { config as dotEnvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotEnvConfig();

// When FORK_CELO=true is set, the default Hardhat network forks Celo mainnet.
// Used exclusively for ClawGame.fork.ts — normal tests always pass without it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hardhatNetwork: any = {};
if (process.env.FORK_CELO === 'true') {
  hardhatNetwork.forking = {
    url: process.env.CELO_RPC_URL ?? 'https://forno.celo.org',
  };
}

const config: HardhatUserConfig = {
  networks: {
    hardhat: hardhatNetwork,
    celoSepolia: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0000000000000000000000000000000000000000000000000000000000000001'],
      url: 'https://forno.celo-sepolia.celo-testnet.org',
    },
    celo: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0000000000000000000000000000000000000000000000000000000000000001'],
      url: 'https://forno.celo.org',
    },
    optimism: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0000000000000000000000000000000000000000000000000000000000000001'],
      url: process.env.OP_RPC_URL ?? 'https://mainnet.optimism.io',
    },
    optimismSepolia: {
      accounts: [process.env.PRIVATE_KEY ?? '0x0000000000000000000000000000000000000000000000000000000000000001'],
      url: 'https://sepolia.optimism.io',
    },

  },
  etherscan: {
    // hardhat-verify v2+ requires a single API key (not per-network)
    apiKey: process.env.CELOSCAN_API_KEY ?? '',
    customChains: [
      {
        chainId: 11142220,
        network: 'celoSepolia',
        urls: {
          apiURL: 'https://api-alfajores.celoscan.io/v2/api',
          browserURL: 'https://alfajores.celoscan.io',
        },
      },
      {
        chainId: 42_220,
        network: 'celo',
        urls: {
          apiURL: 'https://api.celoscan.io/v2/api',
          browserURL: 'https://celoscan.io/',
        },
      },
      {
        chainId: 10,
        network: 'optimism',
        urls: {
          apiURL: 'https://api-optimistic.etherscan.io/v2/api',
          browserURL: 'https://optimistic.etherscan.io/',
        },
      },
      {
        chainId: 11155420,
        network: 'optimismSepolia',
        urls: {
          apiURL: 'https://api-sepolia-optimistic.etherscan.io/v2/api',
          browserURL: 'https://sepolia-optimistic.etherscan.io/',
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
};

export default config;
