"""Make every bcrypt hash in the test run cheap.

Cost 12 is ~250ms per hash and dominates the suite; cost 4 is the bcrypt minimum. Importing this
module patches `bcrypt.gensalt`. `conftest.py` imports it first, before anything loads
`app.security` (which hashes at import time).
"""

import bcrypt

TEST_ROUNDS = 4
REAL_GENSALT = bcrypt.gensalt


def _cheap_gensalt(rounds: int = TEST_ROUNDS, prefix: bytes = b"2b") -> bytes:
    return REAL_GENSALT(rounds, prefix)


bcrypt.gensalt = _cheap_gensalt
