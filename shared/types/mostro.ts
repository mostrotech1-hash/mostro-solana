/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/mostro.json`.
 */
export type Mostro = {
   address: "6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK";
   metadata: {
      name: "mostro";
      version: "0.1.0";
      spec: "0.1.0";
      description: "Mostro on Solana: $MOST bonding curve, artist perks and MoOG Pass redemption";
   };
   instructions: [
      {
         name: "acceptAdmin";
         discriminator: [112, 42, 45, 90, 116, 181, 13, 170];
         accounts: [
            {
               name: "pendingAdmin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "approveProposal";
         discriminator: [136, 108, 102, 85, 98, 114, 7, 147];
         accounts: [
            {
               name: "memberWallet";
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "member";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "memberWallet";
                     },
                  ];
               };
            },
            {
               name: "proposal";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 114, 111, 112, 111, 115, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "proposal.index";
                        account: "proposal";
                     },
                  ];
               };
            },
            {
               name: "approval";
               docs: ["One approval per member per proposal: a second call fails because the PDA exists."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 112, 112, 114, 111, 118, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "proposal";
                     },
                     {
                        kind: "account";
                        path: "memberWallet";
                     },
                  ];
               };
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [];
      },
      {
         name: "buyPerkSol";
         discriminator: [110, 69, 112, 133, 86, 27, 240, 130];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent and the Core protocol fee. Usually the buyer; can be a sponsor."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Pays the SOL and receives the asset."];
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
               relations: ["perk"];
            },
            {
               name: "artistAuthority";
               writable: true;
            },
            {
               name: "perk";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 101, 114, 107];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "perk.index";
                        account: "perk";
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["perk", "curve"];
            },
            {
               name: "curveVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "artistReserve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116, 95, 114, 101, 115, 101, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "rewardsVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 119, 97, 114, 100, 115];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "spend";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 112, 101, 110, 100];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "blacklistEntry";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [98, 108, 97, 99, 107, 108, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "collection";
               writable: true;
               relations: ["perk"];
            },
            {
               name: "asset";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 115, 115, 101, 116];
                     },
                     {
                        kind: "account";
                        path: "perk";
                     },
                     {
                        kind: "arg";
                        path: "nonce";
                     },
                  ];
               };
            },
            {
               name: "receipt";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 99, 101, 105, 112, 116];
                     },
                     {
                        kind: "account";
                        path: "asset";
                     },
                  ];
               };
            },
            {
               name: "mplCoreProgram";
               address: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
            },
            {
               name: "tokenProgram";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "nonce";
               type: "u64";
            },
            {
               name: "maxLamports";
               type: "u64";
            },
         ];
      },
      {
         name: "buyTokensExactOutSol";
         discriminator: [160, 176, 95, 170, 229, 24, 26, 8];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent for the buyer's token account and spend tracker. Usually the buyer; can be a sponsor."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Pays the SOL and receives the tokens."];
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               relations: ["curve"];
            },
            {
               name: "curveVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "buyerAta";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "buyer";
                     },
                     {
                        kind: "account";
                        path: "tokenProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "spend";
               docs: ["Anti-whale counter for this buyer on this curve."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 112, 101, 110, 100];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "blacklistEntry";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [98, 108, 97, 99, 107, 108, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "tokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "tokensOut";
               type: "u64";
            },
            {
               name: "maxLamportsIn";
               type: "u64";
            },
         ];
      },
      {
         name: "buyTokensSol";
         discriminator: [236, 167, 45, 186, 76, 10, 254, 109];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent for the buyer's token account and spend tracker. Usually the buyer; can be a sponsor."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Pays the SOL and receives the tokens."];
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               relations: ["curve"];
            },
            {
               name: "curveVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "buyerAta";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "buyer";
                     },
                     {
                        kind: "account";
                        path: "tokenProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "spend";
               docs: ["Anti-whale counter for this buyer on this curve."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 112, 101, 110, 100];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "blacklistEntry";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [98, 108, 97, 99, 107, 108, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "tokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "lamportsIn";
               type: "u64";
            },
            {
               name: "minTokensOut";
               type: "u64";
            },
         ];
      },
      {
         name: "buyTokensUsdc";
         discriminator: [67, 28, 37, 41, 100, 173, 170, 86];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent for the buyer's token account and spend tracker. Usually the buyer; can be a sponsor."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Owns the USDC and receives the tokens."];
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               relations: ["curve"];
            },
            {
               name: "curveVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "usdcMint";
               relations: ["config"];
            },
            {
               name: "buyerUsdc";
               writable: true;
            },
            {
               name: "usdcVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "treasuryUsdc";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "config";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "buyerAta";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "buyer";
                     },
                     {
                        kind: "account";
                        path: "tokenProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "spend";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 112, 101, 110, 100];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "blacklistEntry";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [98, 108, 97, 99, 107, 108, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "priceUpdate";
            },
            {
               name: "tokenProgram";
            },
            {
               name: "usdcTokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "usdcIn";
               type: "u64";
            },
            {
               name: "minTokensOut";
               type: "u64";
            },
         ];
      },
      {
         name: "cancelAdminTransfer";
         discriminator: [38, 131, 157, 31, 240, 137, 44, 215];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "cancelProposal";
         discriminator: [106, 74, 128, 146, 19, 65, 39, 23];
         accounts: [
            {
               name: "memberWallet";
               signer: true;
            },
            {
               name: "member";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "memberWallet";
                     },
                  ];
               };
            },
            {
               name: "proposal";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 114, 111, 112, 111, 115, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "proposal.index";
                        account: "proposal";
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "createArtist";
         discriminator: [19, 246, 64, 224, 207, 250, 83, 11];
         accounts: [
            {
               name: "admin";
               writable: true;
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "config.artist_count";
                        account: "config";
                     },
                  ];
               };
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "authority";
               type: "pubkey";
            },
            {
               name: "name";
               type: "string";
            },
            {
               name: "uri";
               type: "string";
            },
         ];
      },
      {
         name: "createCurve";
         discriminator: [169, 235, 221, 223, 65, 109, 120, 183];
         accounts: [
            {
               name: "admin";
               writable: true;
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "config.curve_count";
                        account: "config";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 105, 110, 116];
                     },
                     {
                        kind: "account";
                        path: "config.curve_count";
                        account: "config";
                     },
                  ];
               };
            },
            {
               name: "curveVault";
               docs: ["Hot vault: the 28 % sold on the curve."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "artistReserve";
               docs: ["Cold vault: the artist's 50 %."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116, 95, 114, 101, 115, 101, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "mostroReserve";
               docs: ["Cold vault: Mostro's 15 %."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 111, 115, 116, 114, 111, 95, 114, 101, 115, 101, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "dexReserve";
               docs: ["Cold vault: the 7 % DEX liquidity reserve."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [100, 101, 120, 95, 114, 101, 115, 101, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "rewardsVault";
               docs: ["20 % of every redeem lands here."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 119, 97, 114, 100, 115];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "usdcMint";
            },
            {
               name: "usdcVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "metadata";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 116, 97, 100, 97, 116, 97];
                     },
                     {
                        kind: "account";
                        path: "tokenMetadataProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "account";
                     path: "tokenMetadataProgram";
                  };
               };
            },
            {
               name: "tokenProgram";
            },
            {
               name: "usdcTokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "tokenMetadataProgram";
               address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
            {
               name: "rent";
               address: "SysvarRent111111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "createCurveArgs";
                  };
               };
            },
         ];
      },
      {
         name: "createPerk";
         discriminator: [48, 204, 67, 28, 230, 199, 6, 245];
         accounts: [
            {
               name: "signer";
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
            },
            {
               name: "curve";
               docs: ["The artist's curve; the perk is tied to its mint."];
            },
            {
               name: "mint";
            },
            {
               name: "perk";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 101, 114, 107];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "artist.perk_count";
                        account: "artist";
                     },
                  ];
               };
            },
            {
               name: "collection";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110];
                     },
                     {
                        kind: "account";
                        path: "perk";
                     },
                     {
                        kind: "arg";
                        path: "args.collection_salt";
                     },
                  ];
               };
            },
            {
               name: "mplCoreProgram";
               address: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "createPerkArgs";
                  };
               };
            },
         ];
      },
      {
         name: "createProposal";
         discriminator: [132, 116, 68, 174, 216, 160, 198, 22];
         accounts: [
            {
               name: "proposer";
               writable: true;
               signer: true;
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "member";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "proposer";
                     },
                  ];
               };
            },
            {
               name: "proposal";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 114, 111, 112, 111, 115, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "config.proposal_count";
                        account: "config";
                     },
                  ];
               };
            },
            {
               name: "approval";
               docs: ["The proposer's own approval, recorded at creation."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 112, 112, 114, 111, 118, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "proposal";
                     },
                     {
                        kind: "account";
                        path: "proposer";
                     },
                  ];
               };
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "createProposalArgs";
                  };
               };
            },
         ];
      },
      {
         name: "emergencyPause";
         discriminator: [21, 143, 27, 142, 200, 181, 210, 255];
         accounts: [
            {
               name: "memberWallet";
               signer: true;
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "member";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "memberWallet";
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "executeSetMember";
         discriminator: [114, 232, 28, 211, 69, 164, 44, 170];
         accounts: [
            {
               name: "memberWallet";
               writable: true;
               signer: true;
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "member";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "memberWallet";
                     },
                  ];
               };
            },
            {
               name: "proposal";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 114, 111, 112, 111, 115, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "proposal.index";
                        account: "proposal";
                     },
                  ];
               };
            },
            {
               name: "target";
               docs: ["The member record of `proposal.wallet`, created on first appointment."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "proposal.wallet";
                        account: "proposal";
                     },
                  ];
               };
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [];
      },
      {
         name: "executeSolTransfer";
         discriminator: [201, 199, 156, 78, 98, 2, 59, 68];
         accounts: [
            {
               name: "memberWallet";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "member";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "memberWallet";
                     },
                  ];
               };
            },
            {
               name: "proposal";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 114, 111, 112, 111, 115, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "proposal.index";
                        account: "proposal";
                     },
                  ];
               };
            },
            {
               name: "curve";
               docs: ["Required for `VAULT_SOL` (`proposal.curve`), omitted for `VAULT_TREASURY_SOL`."];
               writable: true;
               optional: true;
            },
            {
               name: "source";
               writable: true;
            },
            {
               name: "destination";
               writable: true;
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [];
      },
      {
         name: "executeTokenTransfer";
         discriminator: [56, 178, 89, 210, 83, 156, 33, 36];
         accounts: [
            {
               name: "memberWallet";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "member";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "account";
                        path: "memberWallet";
                     },
                  ];
               };
            },
            {
               name: "proposal";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 114, 111, 112, 111, 115, 97, 108];
                     },
                     {
                        kind: "account";
                        path: "proposal.index";
                        account: "proposal";
                     },
                  ];
               };
            },
            {
               name: "curve";
               docs: ["Required for curve vaults (`proposal.curve`), omitted for the treasury USDC vault."];
               optional: true;
            },
            {
               name: "mint";
            },
            {
               name: "source";
               docs: ["The vault named by `proposal.vault`; its address is recomputed and compared in the handler."];
               writable: true;
            },
            {
               name: "destination";
               writable: true;
            },
            {
               name: "tokenProgram";
            },
         ];
         args: [];
      },
      {
         name: "fulfillReceipt";
         discriminator: [34, 193, 30, 176, 25, 238, 73, 51];
         accounts: [
            {
               name: "signer";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
               relations: ["receipt"];
            },
            {
               name: "receipt";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 99, 101, 105, 112, 116];
                     },
                     {
                        kind: "account";
                        path: "receipt.asset";
                        account: "receipt";
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "initializeConfig";
         discriminator: [208, 127, 21, 1, 194, 190, 196, 70];
         accounts: [
            {
               name: "payer";
               docs: ["Must be the program's upgrade authority so nobody can front-run the init."];
               writable: true;
               signer: true;
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "usdcMint";
            },
            {
               name: "treasuryUsdc";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "config";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "adminMember";
               docs: ["The admin becomes the first governance member (super-admin, weight 2)."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 109, 98, 101, 114];
                     },
                     {
                        kind: "arg";
                        path: "args.admin";
                     },
                  ];
               };
            },
            {
               name: "program";
               address: "6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK";
            },
            {
               name: "programData";
            },
            {
               name: "usdcTokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "initializeConfigArgs";
                  };
               };
            },
         ];
      },
      {
         name: "proposeAdmin";
         discriminator: [121, 214, 199, 212, 87, 39, 117, 234];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "newAdmin";
               type: "pubkey";
            },
         ];
      },
      {
         name: "redeemPerk";
         discriminator: [246, 154, 17, 49, 124, 164, 97, 104];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent and the Core protocol fee. Usually the buyer; can be a sponsor (Openfort/Kora)."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Owns the tokens being spent and receives the asset."];
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
               relations: ["perk"];
            },
            {
               name: "perk";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 101, 114, 107];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "perk.index";
                        account: "perk";
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["perk", "curve"];
            },
            {
               name: "buyerAta";
               writable: true;
            },
            {
               name: "rewardsVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 119, 97, 114, 100, 115];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "collection";
               writable: true;
               relations: ["perk"];
            },
            {
               name: "asset";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 115, 115, 101, 116];
                     },
                     {
                        kind: "account";
                        path: "perk";
                     },
                     {
                        kind: "arg";
                        path: "nonce";
                     },
                  ];
               };
            },
            {
               name: "receipt";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 99, 101, 105, 112, 116];
                     },
                     {
                        kind: "account";
                        path: "asset";
                     },
                  ];
               };
            },
            {
               name: "blacklistEntry";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [98, 108, 97, 99, 107, 108, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "buyer";
                     },
                  ];
               };
            },
            {
               name: "mplCoreProgram";
               address: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
            },
            {
               name: "tokenProgram";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "nonce";
               type: "u64";
            },
            {
               name: "maxPaid";
               type: "u64";
            },
         ];
      },
      {
         name: "setArtist";
         discriminator: [48, 190, 158, 116, 201, 209, 202, 232];
         accounts: [
            {
               name: "signer";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "setArtistArgs";
                  };
               };
            },
         ];
      },
      {
         name: "setBlacklist";
         discriminator: [39, 254, 8, 213, 62, 24, 226, 248];
         accounts: [
            {
               name: "admin";
               writable: true;
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "entry";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [98, 108, 97, 99, 107, 108, 105, 115, 116];
                     },
                     {
                        kind: "arg";
                        path: "wallet";
                     },
                  ];
               };
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "wallet";
               type: "pubkey";
            },
            {
               name: "blocked";
               type: "bool";
            },
         ];
      },
      {
         name: "setConfig";
         discriminator: [108, 158, 154, 175, 212, 98, 52, 66];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "setConfigArgs";
                  };
               };
            },
         ];
      },
      {
         name: "setPerk";
         discriminator: [203, 252, 17, 207, 162, 34, 233, 231];
         accounts: [
            {
               name: "signer";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
               relations: ["perk"];
            },
            {
               name: "perk";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 101, 114, 107];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "perk.index";
                        account: "perk";
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "setPerkArgs";
                  };
               };
            },
         ];
      },
   ];
   accounts: [
      {
         name: "approval";
         discriminator: [233, 9, 153, 49, 11, 222, 59, 130];
      },
      {
         name: "artist";
         discriminator: [142, 136, 31, 244, 208, 44, 128, 145];
      },
      {
         name: "baseCollectionV1";
         discriminator: [5];
      },
      {
         name: "blacklist";
         discriminator: [131, 9, 212, 250, 58, 186, 247, 3];
      },
      {
         name: "config";
         discriminator: [155, 12, 170, 224, 30, 250, 204, 130];
      },
      {
         name: "curve";
         discriminator: [191, 180, 249, 66, 180, 71, 51, 182];
      },
      {
         name: "member";
         discriminator: [54, 19, 162, 21, 29, 166, 17, 198];
      },
      {
         name: "perk";
         discriminator: [2, 34, 178, 63, 67, 155, 249, 194];
      },
      {
         name: "proposal";
         discriminator: [26, 94, 189, 187, 116, 136, 53, 33];
      },
      {
         name: "receipt";
         discriminator: [39, 154, 73, 106, 80, 102, 145, 153];
      },
      {
         name: "spendTracker";
         discriminator: [180, 17, 195, 180, 162, 207, 239, 205];
      },
   ];
   events: [
      {
         name: "adminAccepted";
         discriminator: [174, 12, 76, 139, 158, 99, 110, 254];
      },
      {
         name: "adminProposed";
         discriminator: [129, 249, 226, 227, 199, 82, 110, 243];
      },
      {
         name: "adminTransferCancelled";
         discriminator: [93, 23, 69, 55, 216, 128, 106, 56];
      },
      {
         name: "artistCreated";
         discriminator: [101, 78, 4, 44, 142, 133, 209, 205];
      },
      {
         name: "artistUpdated";
         discriminator: [51, 184, 188, 50, 40, 83, 44, 59];
      },
      {
         name: "blacklistUpdated";
         discriminator: [246, 166, 44, 25, 56, 182, 121, 74];
      },
      {
         name: "configInitialized";
         discriminator: [181, 49, 200, 156, 19, 167, 178, 91];
      },
      {
         name: "configUpdated";
         discriminator: [40, 241, 230, 122, 11, 19, 198, 194];
      },
      {
         name: "curveCreated";
         discriminator: [207, 148, 202, 45, 236, 100, 171, 230];
      },
      {
         name: "emergencyPaused";
         discriminator: [97, 135, 220, 149, 143, 72, 9, 27];
      },
      {
         name: "memberUpdated";
         discriminator: [122, 225, 250, 121, 60, 189, 11, 147];
      },
      {
         name: "perkCreated";
         discriminator: [43, 38, 171, 237, 200, 44, 219, 199];
      },
      {
         name: "perkRedeemed";
         discriminator: [13, 119, 53, 107, 152, 10, 236, 247];
      },
      {
         name: "perkUpdated";
         discriminator: [129, 27, 145, 8, 43, 158, 57, 242];
      },
      {
         name: "proposalApproved";
         discriminator: [70, 49, 155, 228, 157, 43, 88, 49];
      },
      {
         name: "proposalCancelled";
         discriminator: [253, 59, 104, 46, 129, 78, 9, 14];
      },
      {
         name: "proposalCreated";
         discriminator: [186, 8, 160, 108, 81, 13, 51, 206];
      },
      {
         name: "proposalExecuted";
         discriminator: [92, 213, 189, 201, 101, 83, 111, 83];
      },
      {
         name: "receiptFulfilled";
         discriminator: [233, 218, 183, 192, 156, 80, 118, 161];
      },
      {
         name: "tokensBought";
         discriminator: [151, 148, 173, 226, 128, 30, 249, 190];
      },
      {
         name: "vaultTransferred";
         discriminator: [217, 143, 236, 60, 98, 14, 49, 60];
      },
   ];
   errors: [
      {
         code: 6000;
         name: "buysPaused";
         msg: "Curve buys are paused";
      },
      {
         code: 6001;
         name: "redeemsPaused";
         msg: "Perk redemptions are paused";
      },
      {
         code: 6002;
         name: "unauthorized";
         msg: "Signer is not authorized";
      },
      {
         code: 6003;
         name: "saleNotStarted";
         msg: "Sale has not started yet";
      },
      {
         code: 6004;
         name: "perkInactive";
         msg: "Perk is inactive";
      },
      {
         code: 6005;
         name: "perkSoldOut";
         msg: "Perk is sold out";
      },
      {
         code: 6006;
         name: "slippageExceeded";
         msg: "Slippage limit exceeded";
      },
      {
         code: 6007;
         name: "curveSoldOut";
         msg: "Curve supply cap reached";
      },
      {
         code: 6008;
         name: "curveComplete";
         msg: "Curve is complete; the primary market is closed";
      },
      {
         code: 6009;
         name: "insufficientReserves";
         msg: "Insufficient balance in the source vault";
      },
      {
         code: 6010;
         name: "mathOverflow";
         msg: "Arithmetic overflow";
      },
      {
         code: 6011;
         name: "invalidAmount";
         msg: "Invalid amount";
      },
      {
         code: 6012;
         name: "invalidBps";
         msg: "Invalid basis points";
      },
      {
         code: 6013;
         name: "invalidTier";
         msg: "Invalid tier";
      },
      {
         code: 6014;
         name: "invalidCurveParams";
         msg: "Invalid curve parameters";
      },
      {
         code: 6015;
         name: "stringTooLong";
         msg: "String too long";
      },
      {
         code: 6016;
         name: "invalidPriceAccount";
         msg: "Price account does not match config";
      },
      {
         code: 6017;
         name: "priceFeedMismatch";
         msg: "Price feed id mismatch";
      },
      {
         code: 6018;
         name: "priceTooOld";
         msg: "Price is too old";
      },
      {
         code: 6019;
         name: "priceNonPositive";
         msg: "Price is not positive";
      },
      {
         code: 6020;
         name: "priceNotSet";
         msg: "Price not set";
      },
      {
         code: 6021;
         name: "priceUncertain";
         msg: "Price confidence interval too wide";
      },
      {
         code: 6022;
         name: "adminTransferNotReady";
         msg: "Admin transfer not ready";
      },
      {
         code: 6023;
         name: "noPendingAdmin";
         msg: "No pending admin transfer";
      },
      {
         code: 6024;
         name: "invalidCollection";
         msg: "Collection does not match perk";
      },
      {
         code: 6025;
         name: "invalidMint";
         msg: "Mint does not match";
      },
      {
         code: 6026;
         name: "alreadyFulfilled";
         msg: "Receipt already fulfilled";
      },
      {
         code: 6027;
         name: "artistInactive";
         msg: "Artist is inactive";
      },
      {
         code: 6028;
         name: "blacklisted";
         msg: "Wallet is blacklisted";
      },
      {
         code: 6029;
         name: "spendCapExceeded";
         msg: "Monthly SOL spend cap exceeded for this artist";
      },
      {
         code: 6030;
         name: "artistHasCurve";
         msg: "Artist already has a token";
      },
      {
         code: 6031;
         name: "invalidPerkPrice";
         msg: "Perk must be priced in tokens or in SOL, not both or neither";
      },
      {
         code: 6032;
         name: "wrongPerkPayment";
         msg: "Perk is not payable with this instruction";
      },
      {
         code: 6033;
         name: "notAMember";
         msg: "Signer is not a governance member";
      },
      {
         code: 6034;
         name: "invalidRole";
         msg: "Invalid member role";
      },
      {
         code: 6035;
         name: "lastMember";
         msg: "Cannot remove the last voting weight";
      },
      {
         code: 6036;
         name: "invalidProposalKind";
         msg: "Invalid proposal kind";
      },
      {
         code: 6037;
         name: "invalidVault";
         msg: "Invalid vault for this proposal";
      },
      {
         code: 6038;
         name: "proposalClosed";
         msg: "Proposal is executed or cancelled";
      },
      {
         code: 6039;
         name: "proposalExpired";
         msg: "Proposal has expired";
      },
      {
         code: 6040;
         name: "thresholdNotMet";
         msg: "Proposal has not reached the approval threshold";
      },
      {
         code: 6041;
         name: "proposalMismatch";
         msg: "Account does not match the proposal";
      },
   ];
   types: [
      {
         name: "adminAccepted";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "previous";
                  type: "pubkey";
               },
               {
                  name: "admin";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "adminProposed";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "current";
                  type: "pubkey";
               },
               {
                  name: "proposed";
                  type: "pubkey";
               },
               {
                  name: "readyTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "adminTransferCancelled";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "cancelled";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "approval";
         docs: ['One member\'s approval of one proposal. PDA `["approval", proposal, wallet]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "proposal";
                  type: "pubkey";
               },
               {
                  name: "member";
                  type: "pubkey";
               },
               {
                  name: "weight";
                  type: "u16";
               },
               {
                  name: "ts";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "artist";
         docs: ['An artist that opens perks to fans. PDA `["artist", index_le]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "authority";
                  docs: ["Wallet that manages this artist's perks and receives the artist half of hybrid perk sales."];
                  type: "pubkey";
               },
               {
                  name: "curve";
                  docs: ["The artist's curve, or `Pubkey::default()` until `create_curve` runs for it."];
                  type: "pubkey";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "perkCount";
                  type: "u32";
               },
               {
                  name: "revenueLamports";
                  docs: ["Cumulative lamports paid to `authority` by hybrid perks."];
                  type: "u64";
               },
               {
                  name: "active";
                  type: "bool";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 48];
                  };
               },
            ];
         };
      },
      {
         name: "artistCreated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "authority";
                  type: "pubkey";
               },
               {
                  name: "name";
                  type: "string";
               },
            ];
         };
      },
      {
         name: "artistUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "authority";
                  type: "pubkey";
               },
               {
                  name: "active";
                  type: "bool";
               },
            ];
         };
      },
      {
         name: "baseCollectionV1";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "key";
                  type: {
                     defined: {
                        name: "key";
                     };
                  };
               },
               {
                  name: "updateAuthority";
                  type: "pubkey";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "numMinted";
                  type: "u32";
               },
               {
                  name: "currentSize";
                  type: "u32";
               },
            ];
         };
      },
      {
         name: "blacklist";
         docs: ['Blacklist entry. Every wallet is allowed unless `["blacklist", wallet]` exists with', '`blocked == true`. Written by the admin. PDA `["blacklist", wallet]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "wallet";
                  type: "pubkey";
               },
               {
                  name: "blocked";
                  type: "bool";
               },
               {
                  name: "updatedTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "blacklistUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "wallet";
                  type: "pubkey";
               },
               {
                  name: "blocked";
                  type: "bool";
               },
            ];
         };
      },
      {
         name: "config";
         docs: ['Global protocol configuration. Single PDA `["config"]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "admin";
                  docs: ["Operator key: pauses, prices, blacklist, onboarding. Cannot move cold vaults or treasury."];
                  type: "pubkey";
               },
               {
                  name: "pendingAdmin";
                  type: "pubkey";
               },
               {
                  name: "adminTransferReadyTs";
                  type: "i64";
               },
               {
                  name: "adminCooloffSecs";
                  type: "u32";
               },
               {
                  name: "usdcMint";
                  type: "pubkey";
               },
               {
                  name: "treasuryBump";
                  type: "u8";
               },
               {
                  name: "feeBps";
                  docs: ["Protocol fee on curve buys, in basis points of the quote amount."];
                  type: "u16";
               },
               {
                  name: "buysPaused";
                  docs: ["Circuit breakers. Buys cover every curve purchase (SOL, USDC, the curve leg of a hybrid", "perk); redeems cover `redeem_perk` and `buy_perk_sol`."];
                  type: "bool";
               },
               {
                  name: "redeemsPaused";
                  type: "bool";
               },
               {
                  name: "priceMode";
                  docs: ["0 = admin-set price, 1 = Pyth PriceUpdateV2 account."];
                  type: "u8";
               },
               {
                  name: "solUsdPriceE6";
                  docs: ["SOL/USD with 6 decimals (used in `price_mode == 0`)."];
                  type: "u64";
               },
               {
                  name: "priceUpdatedTs";
                  type: "i64";
               },
               {
                  name: "pythSolUsdAccount";
                  type: "pubkey";
               },
               {
                  name: "pythFeedId";
                  type: {
                     array: ["u8", 32];
                  };
               },
               {
                  name: "maxPriceAgeSecs";
                  docs: ["Max age of a Pyth price (mode 1)."];
                  type: "u32";
               },
               {
                  name: "adminPriceMaxAgeSecs";
                  docs: ["Max age of the admin-set SOL/USD price (mode 0)."];
                  type: "u32";
               },
               {
                  name: "launchCooldownSecs";
                  docs: ["Seconds between a token's creation (first mint) and the opening of its curve."];
                  type: "u32";
               },
               {
                  name: "maxSpendPerPeriodLamports";
                  docs: ["Anti-whale cap: lamports a wallet may put into one curve per 30-day period. 0 = no cap."];
                  type: "u64";
               },
               {
                  name: "proposalTtlSecs";
                  docs: ["Lifetime of a governance proposal."];
                  type: "u32";
               },
               {
                  name: "totalWeight";
                  docs: ["Sum of the voting weights of all current members."];
                  type: "u16";
               },
               {
                  name: "memberCount";
                  type: "u16";
               },
               {
                  name: "proposalCount";
                  type: "u64";
               },
               {
                  name: "curveCount";
                  type: "u32";
               },
               {
                  name: "artistCount";
                  type: "u32";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 64];
                  };
               },
            ];
         };
      },
      {
         name: "configInitialized";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "usdcMint";
                  type: "pubkey";
               },
               {
                  name: "feeBps";
                  type: "u16";
               },
               {
                  name: "launchCooldownSecs";
                  type: "u32";
               },
            ];
         };
      },
      {
         name: "configUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "buysPaused";
                  type: "bool";
               },
               {
                  name: "redeemsPaused";
                  type: "bool";
               },
               {
                  name: "priceMode";
                  type: "u8";
               },
               {
                  name: "solUsdPriceE6";
                  type: "u64";
               },
               {
                  name: "feeBps";
                  type: "u16";
               },
               {
                  name: "launchCooldownSecs";
                  type: "u32";
               },
               {
                  name: "maxSpendPerPeriodLamports";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "createCurveArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "symbol";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "virtualSolReserves";
                  docs: ["Virtual quote reserve at genesis (lamports)."];
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  docs: ["Virtual token reserve at genesis (base units). Must exceed `CURVE_ALLOCATION`."];
                  type: "u64";
               },
               {
                  name: "saleStartTs";
                  docs: ["Requested opening time. The curve opens at the later of this and", "`now + config.launch_cooldown_secs`."];
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "createPerkArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "priceTokens";
                  docs: ["Token price (base units). Set exactly one of `price_tokens` / `price_lamports`."];
                  type: "u64";
               },
               {
                  name: "priceLamports";
                  docs: ["SOL price (lamports) for a hybrid perk."];
                  type: "u64";
               },
               {
                  name: "maxSupply";
                  type: "u32";
               },
               {
                  name: "publicStartTs";
                  type: "i64";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "collectionSalt";
                  docs: ["Client-chosen salt for the collection address, so a squatted (pre-funded) PDA can be skipped."];
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "createProposalArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "kind";
                  docs: ["`PROPOSAL_VAULT_TRANSFER` or `PROPOSAL_SET_MEMBER`."];
                  type: "u8";
               },
               {
                  name: "curve";
                  docs: ["Vault transfer: the curve whose vault moves (zero for the treasury vaults)."];
                  type: "pubkey";
               },
               {
                  name: "vault";
                  docs: ["Vault transfer: one of the `VAULT_*` constants."];
                  type: "u8";
               },
               {
                  name: "destination";
                  docs: ["Vault transfer: token account (token vaults) or system account (SOL vaults) that receives."];
                  type: "pubkey";
               },
               {
                  name: "amount";
                  docs: ["Vault transfer: base units or lamports."];
                  type: "u64";
               },
               {
                  name: "wallet";
                  docs: ["Set member: the wallet."];
                  type: "pubkey";
               },
               {
                  name: "role";
                  docs: ["Set member: `ROLE_ADMIN`, `ROLE_SUPER_ADMIN`, or `ROLE_NONE` to remove."];
                  type: "u8";
               },
            ];
         };
      },
      {
         name: "curve";
         docs: [
            'One artist token and its bonding curve. PDA `["curve", index_le]`.',
            "",
            "Vaults (all owned by this PDA): `curve_vault` (hot, 28 %), `artist_reserve` (cold, 50 %),",
            "`mostro_reserve` (cold, 15 %), `dex_reserve` (cold, 7 %), `rewards_vault` (20 % of redeems),",
            "`sol_vault` (SOL paid on the curve) and the USDC ATA. Cold vaults, `sol_vault` and the USDC",
            "vault move only through an executed governance proposal.",
         ];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "artist";
                  docs: ["Artist PDA this token belongs to. One token per artist."];
                  type: "pubkey";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "solVaultBump";
                  type: "u8";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "symbol";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "virtualSolReserves";
                  docs: ["Constant-product virtual reserves (pump.fun style), quote = lamports."];
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
               {
                  name: "realSolReserves";
                  docs: ["Real SOL held in `sol_vault` (never includes the rent floor)."];
                  type: "u64";
               },
               {
                  name: "realUsdcReserves";
                  docs: ["USDC received through `buy_tokens_usdc` (informational)."];
                  type: "u64";
               },
               {
                  name: "supplyCap";
                  docs: ["Tokens the curve may sell: `CURVE_ALLOCATION`. Reaching it marks the curve `complete`."];
                  type: "u64";
               },
               {
                  name: "tokensSold";
                  docs: ["Tokens that left `curve_vault` through buys and hybrid perks."];
                  type: "u64";
               },
               {
                  name: "artistReserveUsed";
                  docs: ["Tokens that left `artist_reserve` through hybrid perks."];
                  type: "u64";
               },
               {
                  name: "totalBurned";
                  type: "u64";
               },
               {
                  name: "rewardsAccrued";
                  type: "u64";
               },
               {
                  name: "saleStartTs";
                  docs: ["Opening time of the curve: `created_at + config.launch_cooldown_secs` at the earliest."];
                  type: "i64";
               },
               {
                  name: "createdAt";
                  type: "i64";
               },
               {
                  name: "complete";
                  type: "bool";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 64];
                  };
               },
            ];
         };
      },
      {
         name: "curveCreated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "curve";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "virtualSolReserves";
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
               {
                  name: "supplyCap";
                  type: "u64";
               },
               {
                  name: "saleStartTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "emergencyPaused";
         docs: ["A member pulled the circuit breaker: buys and redeems are both paused."];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "by";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "initializeConfigArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  docs: ["Operator key and founding super-admin of the multisig."];
                  type: "pubkey";
               },
               {
                  name: "feeBps";
                  type: "u16";
               },
               {
                  name: "solUsdPriceE6";
                  type: "u64";
               },
               {
                  name: "maxPriceAgeSecs";
                  type: "u32";
               },
               {
                  name: "pythSolUsdAccount";
                  type: "pubkey";
               },
               {
                  name: "pythFeedId";
                  type: {
                     array: ["u8", 32];
                  };
               },
               {
                  name: "adminCooloffSecs";
                  type: "u32";
               },
               {
                  name: "adminPriceMaxAgeSecs";
                  type: "u32";
               },
               {
                  name: "launchCooldownSecs";
                  docs: ["Seconds between a token's first mint and the opening of its curve (product: 24 h)."];
                  type: "u32";
               },
               {
                  name: "maxSpendPerPeriodLamports";
                  docs: ["Anti-whale cap in lamports per wallet, per curve, per 30-day period. 0 = off."];
                  type: "u64";
               },
               {
                  name: "proposalTtlSecs";
                  type: "u32";
               },
            ];
         };
      },
      {
         name: "key";
         type: {
            kind: "enum";
            variants: [
               {
                  name: "uninitialized";
               },
               {
                  name: "assetV1";
               },
               {
                  name: "hashedAssetV1";
               },
               {
                  name: "pluginHeaderV1";
               },
               {
                  name: "pluginRegistryV1";
               },
               {
                  name: "collectionV1";
               },
               {
                  name: "groupV1";
               },
            ];
         };
      },
      {
         name: "member";
         docs: ['Governance member. PDA `["member", wallet]`. `role == ROLE_NONE` means removed.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "wallet";
                  type: "pubkey";
               },
               {
                  name: "role";
                  type: "u8";
               },
               {
                  name: "updatedTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "memberUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "wallet";
                  type: "pubkey";
               },
               {
                  name: "role";
                  type: "u8";
               },
               {
                  name: "totalWeight";
                  type: "u16";
               },
            ];
         };
      },
      {
         name: "perk";
         docs: [
            'Something a fan can get. PDA `["perk", artist, index_le]`.',
            "",
            "Exactly one of `price_tokens` / `price_lamports` is non-zero:",
            "- `price_tokens > 0`: the fan pays tokens from its wallet (`redeem_perk`).",
            "- `price_lamports > 0`: hybrid perk, the fan pays SOL (`buy_perk_sol`); the tokens come half from",
            "the curve and half from the artist reserve.",
            "",
            "Either way 80 % of the tokens involved are burned and 20 % go to the rewards vault.",
         ];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  docs: ["Token the perk is tied to (the artist's curve mint)."];
                  type: "pubkey";
               },
               {
                  name: "collection";
                  docs: ["Metaplex Core collection every minted asset belongs to."];
                  type: "pubkey";
               },
               {
                  name: "collectionBump";
                  type: "u8";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  docs: ["Pass tier (0 Classic, 1 VIP). Zero for non-pass perks. Informational."];
                  type: "u8";
               },
               {
                  name: "priceTokens";
                  docs: ["Price in token base units (6 decimals). 0 for hybrid perks."];
                  type: "u64";
               },
               {
                  name: "priceLamports";
                  docs: ["Price in lamports. 0 for token-priced perks."];
                  type: "u64";
               },
               {
                  name: "maxSupply";
                  docs: ["0 = unlimited."];
                  type: "u32";
               },
               {
                  name: "sold";
                  type: "u32";
               },
               {
                  name: "publicStartTs";
                  docs: ["Unix time from which the perk can be redeemed."];
                  type: "i64";
               },
               {
                  name: "active";
                  type: "bool";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 48];
                  };
               },
            ];
         };
      },
      {
         name: "perkCreated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "collection";
                  type: "pubkey";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "priceTokens";
                  type: "u64";
               },
               {
                  name: "priceLamports";
                  type: "u64";
               },
               {
                  name: "maxSupply";
                  type: "u32";
               },
            ];
         };
      },
      {
         name: "perkKind";
         docs: [
            "Kind of perk an artist opens to fans. The program does not interpret it: it is written into the",
            "minted asset's attributes so the web app can render the right benefit. Pass benefits (discounts,",
            "early access, VIP areas) are applied by the web app, not on-chain.",
         ];
         repr: {
            kind: "rust";
         };
         type: {
            kind: "enum";
            variants: [
               {
                  name: "pass";
               },
               {
                  name: "music";
               },
               {
                  name: "event";
               },
               {
                  name: "merch";
               },
            ];
         };
      },
      {
         name: "perkRedeemed";
         docs: ["Emitted by both `redeem_perk` (tokens) and `buy_perk_sol` (hybrid)."];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "buyer";
                  type: "pubkey";
               },
               {
                  name: "asset";
                  type: "pubkey";
               },
               {
                  name: "receipt";
                  type: "pubkey";
               },
               {
                  name: "edition";
                  type: "u32";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "paidTokens";
                  type: "u64";
               },
               {
                  name: "paidLamports";
                  type: "u64";
               },
               {
                  name: "tokensFromCurve";
                  type: "u64";
               },
               {
                  name: "tokensFromArtist";
                  type: "u64";
               },
               {
                  name: "burned";
                  type: "u64";
               },
               {
                  name: "toRewards";
                  type: "u64";
               },
               {
                  name: "lamportsToCurve";
                  type: "u64";
               },
               {
                  name: "lamportsToArtist";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "perkUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "priceTokens";
                  type: "u64";
               },
               {
                  name: "priceLamports";
                  type: "u64";
               },
               {
                  name: "active";
                  type: "bool";
               },
               {
                  name: "maxSupply";
                  type: "u32";
               },
               {
                  name: "publicStartTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "proposal";
         docs: ['A governance proposal. PDA `["proposal", index_le]`. Payload fields are flat so the IDL stays', "simple; the ones a `kind` does not use are zero."];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "index";
                  type: "u64";
               },
               {
                  name: "proposer";
                  type: "pubkey";
               },
               {
                  name: "kind";
                  docs: ["`PROPOSAL_VAULT_TRANSFER` or `PROPOSAL_SET_MEMBER`."];
                  type: "u8";
               },
               {
                  name: "createdTs";
                  type: "i64";
               },
               {
                  name: "expiresTs";
                  type: "i64";
               },
               {
                  name: "approvedWeight";
                  type: "u16";
               },
               {
                  name: "executed";
                  type: "bool";
               },
               {
                  name: "cancelled";
                  type: "bool";
               },
               {
                  name: "curve";
                  docs: ["Vault transfer: the curve (zero for treasury vaults), which vault, where to, how much."];
                  type: "pubkey";
               },
               {
                  name: "vault";
                  type: "u8";
               },
               {
                  name: "destination";
                  type: "pubkey";
               },
               {
                  name: "amount";
                  type: "u64";
               },
               {
                  name: "wallet";
                  docs: ["Set member: the wallet and its new role (`ROLE_NONE` removes it)."];
                  type: "pubkey";
               },
               {
                  name: "role";
                  type: "u8";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 32];
                  };
               },
            ];
         };
      },
      {
         name: "proposalApproved";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "proposal";
                  type: "pubkey";
               },
               {
                  name: "member";
                  type: "pubkey";
               },
               {
                  name: "weight";
                  type: "u16";
               },
               {
                  name: "approvedWeight";
                  type: "u16";
               },
               {
                  name: "totalWeight";
                  type: "u16";
               },
            ];
         };
      },
      {
         name: "proposalCancelled";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "proposal";
                  type: "pubkey";
               },
               {
                  name: "by";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "proposalCreated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "proposal";
                  type: "pubkey";
               },
               {
                  name: "index";
                  type: "u64";
               },
               {
                  name: "proposer";
                  type: "pubkey";
               },
               {
                  name: "kind";
                  type: "u8";
               },
               {
                  name: "expiresTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "proposalExecuted";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "proposal";
                  type: "pubkey";
               },
               {
                  name: "kind";
                  type: "u8";
               },
               {
                  name: "by";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "receipt";
         docs: ['Proof of a redemption, keyed by the minted asset. PDA `["receipt", asset]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "buyer";
                  type: "pubkey";
               },
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "asset";
                  type: "pubkey";
               },
               {
                  name: "edition";
                  type: "u32";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "paidTokens";
                  docs: ["Tokens the buyer spent from its wallet (token-priced perks)."];
                  type: "u64";
               },
               {
                  name: "paidLamports";
                  docs: ["Lamports the buyer spent (hybrid perks)."];
                  type: "u64";
               },
               {
                  name: "tokensFromCurve";
                  docs: ["Tokens taken from `curve_vault` (hybrid perks)."];
                  type: "u64";
               },
               {
                  name: "tokensFromArtist";
                  docs: ["Tokens taken from `artist_reserve` (hybrid perks)."];
                  type: "u64";
               },
               {
                  name: "burned";
                  type: "u64";
               },
               {
                  name: "toRewards";
                  type: "u64";
               },
               {
                  name: "lamportsToCurve";
                  docs: ["Lamports that went into the curve (`sol_vault` + fee) and to the artist wallet."];
                  type: "u64";
               },
               {
                  name: "lamportsToArtist";
                  type: "u64";
               },
               {
                  name: "ts";
                  type: "i64";
               },
               {
                  name: "fulfilled";
                  docs: ["Set by the artist once a physical/off-chain perk was delivered."];
                  type: "bool";
               },
               {
                  name: "fulfilledTs";
                  type: "i64";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 32];
                  };
               },
            ];
         };
      },
      {
         name: "receiptFulfilled";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "receipt";
                  type: "pubkey";
               },
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "by";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "setArtistArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "authority";
                  type: {
                     option: "pubkey";
                  };
               },
               {
                  name: "name";
                  type: {
                     option: "string";
                  };
               },
               {
                  name: "uri";
                  type: {
                     option: "string";
                  };
               },
               {
                  name: "active";
                  type: {
                     option: "bool";
                  };
               },
            ];
         };
      },
      {
         name: "setConfigArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "buysPaused";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "redeemsPaused";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "priceMode";
                  type: {
                     option: "u8";
                  };
               },
               {
                  name: "solUsdPriceE6";
                  type: {
                     option: "u64";
                  };
               },
               {
                  name: "pythSolUsdAccount";
                  type: {
                     option: "pubkey";
                  };
               },
               {
                  name: "pythFeedId";
                  type: {
                     option: {
                        array: ["u8", 32];
                     };
                  };
               },
               {
                  name: "maxPriceAgeSecs";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "adminPriceMaxAgeSecs";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "feeBps";
                  type: {
                     option: "u16";
                  };
               },
               {
                  name: "launchCooldownSecs";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "maxSpendPerPeriodLamports";
                  type: {
                     option: "u64";
                  };
               },
               {
                  name: "proposalTtlSecs";
                  type: {
                     option: "u32";
                  };
               },
            ];
         };
      },
      {
         name: "setPerkArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "priceTokens";
                  type: {
                     option: "u64";
                  };
               },
               {
                  name: "priceLamports";
                  type: {
                     option: "u64";
                  };
               },
               {
                  name: "active";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "maxSupply";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "publicStartTs";
                  type: {
                     option: "i64";
                  };
               },
               {
                  name: "uri";
                  type: {
                     option: "string";
                  };
               },
            ];
         };
      },
      {
         name: "spendTracker";
         docs: ["Anti-whale tracker: lamports one wallet put into one curve in the current 30-day period.", 'PDA `["spend", curve, wallet]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "curve";
                  type: "pubkey";
               },
               {
                  name: "wallet";
                  type: "pubkey";
               },
               {
                  name: "period";
                  docs: ["`unix_time / SPEND_PERIOD_SECS` of the period `spent_lamports` refers to."];
                  type: "i64";
               },
               {
                  name: "spentLamports";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "tokensBought";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "curve";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "buyer";
                  type: "pubkey";
               },
               {
                  name: "quoteKind";
                  docs: ["0 = SOL, 1 = USDC, 2 = curve leg of a hybrid perk"];
                  type: "u8";
               },
               {
                  name: "quoteIn";
                  type: "u64";
               },
               {
                  name: "quoteNet";
                  type: "u64";
               },
               {
                  name: "fee";
                  type: "u64";
               },
               {
                  name: "tokensOut";
                  type: "u64";
               },
               {
                  name: "virtualSolReserves";
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "vaultTransferred";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "proposal";
                  type: "pubkey";
               },
               {
                  name: "curve";
                  type: "pubkey";
               },
               {
                  name: "vault";
                  type: "u8";
               },
               {
                  name: "destination";
                  type: "pubkey";
               },
               {
                  name: "amount";
                  type: "u64";
               },
            ];
         };
      },
   ];
};
