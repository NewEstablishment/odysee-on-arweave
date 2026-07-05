%%% Real LBRY channel signing keys for migration tests. Each key was generated
%%% by coincurve (the library LBRY uses), PEM-exported exactly as
%%% `Account.add_channel_private_key' stores them, and packed into a genuine
%%% wallet-sync blob with the LBRY SDK's own crypto. `ScalarHex' is the key's
%%% private scalar captured at generation, so a test can prove a migrated wallet
%%% is byte-for-byte the user's original channel key. Shared here so the codec
%%% suite and the end-to-end auth suite use one copy.
-define(LBRY_CHANNEL_KEYS, [
    {
        <<
            "-----BEGIN PRIVATE KEY-----\n"
            "MIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgTR/rBa6+7FSfQGwoPYGp\n"
            "+43dVZJfzHfzf0wBO7M2vWGhRANCAATdndp4L1wmxMH4iROIkK7IUW2VPXhAu/gP\n"
            "uA+ZDDOqat4gAxdU86ss/YlmWuuaB89RIR6iurUY5v9yN5oI0akp\n"
            "-----END PRIVATE KEY-----\n"
        >>,
        <<"4d1feb05aebeec549f406c283d81a9fb8ddd55925fcc77f37f4c013bb336bd61">>
    },
    {
        <<
            "-----BEGIN PRIVATE KEY-----\n"
            "MIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgETwYdyHvsg5QXfzDAIaU\n"
            "Hcw14KdFqz+2yN6dRCZ4l/uhRANCAARYoiuApOiN0HLDf9CqfYlb65XO4ueQOCi0\n"
            "UtKF1z/OTZ4Fixxr8KDe+o2WspJqnoJ1ip9gfkK/REhkyYTYgbB8\n"
            "-----END PRIVATE KEY-----\n"
        >>,
        <<"113c187721efb20e505dfcc30086941dcc35e0a745ab3fb6c8de9d44267897fb">>
    },
    {
        <<
            "-----BEGIN PRIVATE KEY-----\n"
            "MIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgN7HdV0I2LvrfxhOI4mRw\n"
            "PMlED2MXW0Nkxwts9vJfX5+hRANCAASX9Jh9in7VcyNLMxtkzMeQCnxJoVr18GvX\n"
            "SdQQGd0TLakEjAw8ZnnD7MsJdp7QQq4D8r2v+vXLxw2Y/jcPz8ho\n"
            "-----END PRIVATE KEY-----\n"
        >>,
        <<"37b1dd5742362efadfc61388e264703cc9440f63175b4364c70b6cf6f25f5f9f">>
    }
]).
