"""Regenerates the committed goldens and seed.sql from products.json.

Run after editing tests/fixtures/products.json:

    python3 api-rs/tests/fixtures/generate_goldens.py

The product fixtures are the single source of truth for the byte-compared
responses in tests/parity.rs, and the same rows the hermetic E2E database is
seeded from. One owned row (prod-owned-1, with the latest createdAt so it sorts
last) exists so the store LEFT JOIN and the seller identity fields are exercised
by the goldens rather than only by the E2E suite.
"""

import json
from pathlib import Path

HERE = Path(__file__).parent
products = json.loads((HERE / "products.json").read_text())

# The seller behind the owned fixture row. Written into seed.sql and mirrored by
# FIXTURE_STORE_* in tests/common/mod.rs, which inserts it through sqlx.
STORE_ID = "usr_fixture_store"
STORE_NAME = "Riverbend Vintage"
STORE_EMAIL = "fixture-store@rnw.test"
# A real (if cheap) argon2id PHC string for a fixture-only password. The E2E suite
# registers its own sellers over HTTP; this row only has to exist so the join has
# something to find.
STORE_PASSWORD_HASH = (
    "$argon2id$v=19$m=64,t=1,p=1$"
    "c21lZHNlZWRzYWx0"
    "$Z8eOWr6d1Fhr1sBqHk1nQvJ8o0Wm3p1k5d1lQ0hE2o0"
)


def js_product(product):
    owner_id = product.get("ownerId")
    return {
        "id": product["id"],
        "title": product["title"],
        "description": product["description"],
        "price": product["price"],
        "currency": product["currency"],
        "imageUrl": product["imageUrl"],
        "stock": product["stock"],
        "createdAt": product["createdAt"].replace(" ", "T") + "Z",
        # Always present, `null` when the product has no seller — the shape
        # api-rs emits, including for the seeded rows.
        "storeId": owner_id,
        "storeName": STORE_NAME if owner_id else None,
    }


def write(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


ordered = sorted(products, key=lambda p: (p["createdAt"], p["id"]))
write(
    "products-page-1.json",
    {
        "items": [js_product(p) for p in ordered[:20]],
        "page": 1,
        "limit": 20,
        "total": len(ordered),
        "hasNextPage": len(ordered) > 20,
    },
)
write(
    "products-page-2.json",
    {
        "items": [js_product(p) for p in ordered[20:40]],
        "page": 2,
        "limit": 20,
        "total": len(ordered),
        "hasNextPage": len(ordered) > 40,
    },
)
write("product-prod-1.json", js_product(next(p for p in products if p["id"] == "prod-1")))
write(
    "product-prod-owned-1.json",
    js_product(next(p for p in products if p["id"] == "prod-owned-1")),
)
write("store-fixture.json", {"id": STORE_ID, "storeName": STORE_NAME, "createdAt": "2026-01-01T00:00:00.000Z"})
write(
    "product-404.json",
    {"message": "Product does-not-exist not found", "error": "Not Found", "statusCode": 404},
)
write("route-404.json", {"message": "Cannot GET /nope?x=1", "error": "Not Found", "statusCode": 404})
write("internal-500.json", {"statusCode": 500, "message": "Internal server error"})
write(
    "unauthorized-401.json",
    {"message": "Unauthorized", "error": "Unauthorized", "statusCode": 401},
)
write(
    "health-up.json",
    {
        "status": "ok",
        "info": {"database": {"responseTime": 0, "status": "up"}},
        "error": {},
        "details": {"database": {"responseTime": 0, "status": "up"}},
    },
)


def sql_string(value):
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


user_sql = (
    'INSERT INTO "User" ("id", "email", "passwordHash", "storeName", "createdAt") VALUES'
    f"({sql_string(STORE_ID)}, {sql_string(STORE_EMAIL)}, {sql_string(STORE_PASSWORD_HASH)}, "
    f"{sql_string(STORE_NAME)}, '2026-01-01 00:00:00.000');"
)

sql = [
    'INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt", "ownerId") VALUES'
]
values = []
for product in products:
    values.append(
        "(" + ", ".join(
            [
                sql_string(product["id"]),
                sql_string(product["title"]),
                sql_string(product["description"]),
                repr(product["price"]),
                sql_string(product["currency"]),
                sql_string(product["imageUrl"]),
                str(product["stock"]),
                sql_string(product["createdAt"]),
                sql_string(product.get("ownerId")),
            ]
        ) + ")"
    )
sql.append(",\n".join(values) + ";")
(HERE / "seed.sql").write_text(user_sql + "\n" + "\n".join(sql) + "\n")