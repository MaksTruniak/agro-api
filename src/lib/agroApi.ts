const API_BASE = 'http://192.168.88.164:4000';
const API_KEY = 'agp_live_c1d866d8c557d5df57953afeb8f98e88b5f74d69baa4cbcd261c4c75c02e67b3';

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
};

export const agroApi = {
    getProducts: async (params?: {
        search?: string
        type?: string
        manufacturer?: string
        page?: number
        limit?: number
    }) => {
        const query = new URLSearchParams();
        if (params?.search) query.append('q', params.search);
        if (params?.type) query.append('type', params.type);
        if (params?.manufacturer) query.append('manufacturer', params.manufacturer);
        if (params?.page) query.append('page', params.page.toString());
        if (params?.limit) query.append('limit', (params.limit || 15).toString());
        const res = await fetch(`${API_BASE}/v1/products?${query}`, { headers });
        return res.json();
    },

    getProduct: async (slug: string) => {
        const res = await fetch(`${API_BASE}/v1/products/${slug}`, { headers });
        return res.json();
    },

    getAnalogs: async (slug: string) => {
        const res = await fetch(`${API_BASE}/v1/products/${slug}/analogs`, { headers });
        return res.json();
    },

    searchActiveIngredients: async (query: string) => {
        const res = await fetch(`${API_BASE}/v1/active-ingredients/search?q=${query}`, { headers });
        return res.json();
    },

    matchProducts: async (query: string) => {
        const res = await fetch(`${API_BASE}/v1/product-match`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query }),
        });
        return res.json();
    },

    getProductTypes: async () => {
        const res = await fetch(`${API_BASE}/v1/product-types`, { headers });
        return res.json();
    },

    getManufacturers: async () => {
        const res = await fetch(`${API_BASE}/v1/manufacturers`, { headers });
        return res.json();
    },

    getCatalogFacets: async () => {
        const res = await fetch(`${API_BASE}/v1/catalog/facets`, { headers });
        return res.json();
    },
};
