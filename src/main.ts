import { CeramicClient } from "@ceramicnetwork/http-client";
import { sha256 } from "multiformats/hashes/sha2";
import * as uint8arrays from "uint8arrays";
import { Ed25519Provider } from "key-did-provider-ed25519";
import * as ThreeIdResolver from "@ceramicnetwork/3id-did-resolver";
import * as KeyDidResolver from "key-did-resolver";
import { Resolver } from "did-resolver";
import { DID } from "dids";
import { TileDocument } from "@ceramicnetwork/stream-tile";
import _ from "lodash";
import * as providers from "@ethersproject/providers";
import * as ethers from "ethers";
import * as linking from "@ceramicnetwork/blockchain-utils-linking";
import { Caip10Link } from "@ceramicnetwork/stream-caip10-link";
import all from 'it-all'

const SEED_SOURCE = `SEED-${Math.random()}`;
const ETHEREUM_SEED = `ETH-SEED-${Math.random()}`;

async function createCeramic() {
  const ceramic = new CeramicClient();
  const digest = await sha256.digest(uint8arrays.fromString(SEED_SOURCE));
  const seed = digest.digest;
  const provider = new Ed25519Provider(seed);
  const keyDidResolver = KeyDidResolver.getResolver();
  const threeIdResolver = ThreeIdResolver.getResolver(ceramic);
  const resolver = new Resolver({
    ...threeIdResolver,
    ...keyDidResolver,
  });
  const did = new DID({ provider, resolver });
  await ceramic.setDID(did);
  await did.authenticate();

  return ceramic;
}

export async function main() {
  const ceramic = await createCeramic();
  const content0 = {
    foo: `hello-${Math.random()}`,
  };
  const tile = await TileDocument.create(ceramic, content0);
  if (!_.isEqual(content0, tile.content)) {
    console.error(`content0 is different`);
    process.exit(1);
  } else {
    console.log("content0 ok");
  }
  const content1 = { foo: `world-${Math.random()}` };
  await tile.update(content1);
  if (!_.isEqual(content1, tile.content)) {
    console.error(`content1 is different`);
    process.exit(1);
  } else {
    console.log("content1 ok");
  }

  const provider = new providers.InfuraProvider(
    "rinkeby",
    "f966355792d1460593a1faec002867a1"
  );
  const ethPrivateKeyDigest = await sha256.digest(
    uint8arrays.fromString(ETHEREUM_SEED)
  );
  const ethPrivateKey = ethPrivateKeyDigest.digest;
  const wallet = new ethers.Wallet(ethPrivateKey).connect(provider);
  const ethersWrap = {
    send: (request: any, callback) => {
      const method = request.method;
      if (method === "personal_sign") {
        const hexMessage = request.params[0];
        const stringMessage = uint8arrays.toString(
          uint8arrays.fromString(hexMessage.replace("0x", ""), "base16")
        );
        wallet
          .signMessage(stringMessage)
          .then((result) => {
            callback(null, { result });
          })
          .catch((e) => {
            callback(e);
          });
      } else {
        provider
          .send(method, request.params)
          .then((result) => {
            callback(null, { result });
          })
          .catch((error) => {
            callback(error);
          });
      }
    },
  };
  const authProvider = new linking.EthereumAuthProvider(
    ethersWrap,
    wallet.address
  );
  const caip = await Caip10Link.fromAccount(
    ceramic,
    await authProvider.accountId()
  );
  await caip.setDid(ceramic.did, authProvider);
  if (!_.isEqual(caip.did, ceramic.did.id)) {
    console.error(`did is different`);
    process.exit(1);
  } else {
    console.log("did ok");
  }

  // Pin
  const streamIds = [tile.id, caip.id]
  for (let s of streamIds) {
    await ceramic.pin.add(s)
  }
  // Make sure pinned
  const pinnedAll = await ceramic.pin.ls().then(r => all(r))
  for (let s of streamIds) {
    const isPresent = pinnedAll.includes(s.toString())
    if (isPresent) {
      console.log(`Stream ${s} pinned ok`)
    } else {
      console.error(`Stream ${s} not pinned`)
      process.exit(1)
    }
  }

  // Unpin
  for (let s of streamIds) {
    await ceramic.pin.rm(s)
  }

  // Make sure unpinned
  const pinnedAll1 = await ceramic.pin.ls().then(r => all(r))
  for (let s of streamIds) {
    const isPresent = pinnedAll1.includes(s.toString())
    if (!isPresent) {
      console.log(`Stream ${s} unpinned ok`)
    } else {
      console.error(`Stream ${s} not unpinned`)
      process.exit(1)
    }
  }

}
