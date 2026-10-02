import json
from pathlib import Path


HERE = Path(__file__).parent
products = json.loads((HERE / "products.json").read_text())


def js_product(product):
    return {
        "id": product["id"],
        "title": product["title"],
        "description": product["description"],
        "price": product["price"],
        "currency": product["currency"],
        "imageUrl": product["imageUrl"],
        "stock": product["stock"],
        "createdAt": product["createdAt"].replace(" ", "T") + "Z",
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
    "product-404.json",
    {"message": "Product does-not-exist not found", "error": "Not Found", "statusCode": 404},
)
write("route-404.json", {"message": "Cannot GET /nope?x=1", "error": "Not Found", "statusCode": 404})
write("internal-500.json", {"statusCode": 500, "message": "Internal server error"})
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


sql = [
    'INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt") VALUES'
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
            ]
        ) + ")"
    )
sql.append(",\n".join(values) + ";")
(HERE / "seed.sql").write_text("\n".join(sql) + "\n")
