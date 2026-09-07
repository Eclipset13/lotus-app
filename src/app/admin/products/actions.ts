"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export async function createProduct(formData: FormData) {
    if (!(await isAdminAuthenticated())) {
        redirect("/admin/login");
    }

    const name = String(formData.get("name") || "").trim();
    const description = String(
        formData.get("description") || ""
    ).trim();

    const imageUrl = String(
        formData.get("image_url") || ""
    ).trim();

    const priceText = String(formData.get("price") || "")
        .trim()
        .replace(",", ".");

    const price = Number(priceText);
    const isActive = formData.get("is_active") === "on";

    if (!name) {
        throw new Error("Введите название букета");
    }

    if (!Number.isFinite(price) || price < 0) {
        throw new Error("Укажите правильную цену");
    }

    await db.query(
        `
      INSERT INTO products (
        name,
        description,
        price,
        image_url,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
        [
            name,
            description || null,
            price,
            imageUrl || null,
            isActive,
        ]
    );

    revalidatePath("/admin/products");
    revalidatePath("/");

    redirect("/admin/products");
}

export async function updateProduct(
    productId: string,
    formData: FormData
) {
    if (!(await isAdminAuthenticated())) {
        redirect("/admin/login");
    }

    const name = String(formData.get("name") || "").trim();
    const description = String(
        formData.get("description") || ""
    ).trim();
    const imageUrl = String(formData.get("image_url") || "").trim();

    const priceText = String(formData.get("price") || "")
        .trim()
        .replace(",", ".");

    const price = Number(priceText);
    const isActive = formData.get("is_active") === "on";

    if (!name) {
        throw new Error("Введите название букета");
    }

    if (!Number.isFinite(price) || price < 0) {
        throw new Error("Укажите правильную цену");
    }

    await db.query(
        `
      UPDATE products
      SET
        name = $1,
        description = $2,
        price = $3,
        image_url = $4,
        is_active = $5,
        updated_at = NOW()
      WHERE id::text = $6
    `,
        [
            name,
            description || null,
            price,
            imageUrl || null,
            isActive,
            productId,
        ]
    );

    revalidatePath("/admin/products");
    revalidatePath("/");

    redirect("/admin/products");
}

export async function toggleProductVisibility(productId: string) {
    if (!(await isAdminAuthenticated())) {
        redirect("/admin/login");
    }

    await db.query(
        `
      UPDATE products
      SET
        is_active = NOT is_active,
        updated_at = NOW()
      WHERE id::text = $1
    `,
        [productId]
    );

    revalidatePath("/admin/products");
    revalidatePath("/");
}