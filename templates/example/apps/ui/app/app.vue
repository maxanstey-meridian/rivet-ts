<script setup lang="ts">
import { addQuoteRequest } from "__PACKAGE_SCOPE__/api/validation";
import { client } from "__PACKAGE_SCOPE__/contracts";
import { reactive, ref } from "vue";

// The SAME schema validates this form and the api's front door — edit a
// rule in modules/quotes/quotes-validation.ts and both change together.
const state = reactive({ text: "", author: "" });
const serverError = ref<string | null>(null);
const quotes = ref<Array<{ id: string; text: string; author: string }>>([]);

// openapi-fetch never throws on HTTP errors — always handle { data, error }.
const { data: me, error: meError } = await client.GET("/api/me");

async function refreshQuotes() {
  const { data, error } = await client.GET("/api/quotes");
  if (!error) {
    quotes.value = data ?? [];
  }
}

await refreshQuotes();

async function onSubmit() {
  serverError.value = null;
  const { error } = await client.POST("/api/quotes", { body: { ...state } });
  if (error) {
    serverError.value = (error as { message?: string }).message ?? "Request failed.";
    return;
  }
  state.text = "";
  state.author = "";
  await refreshQuotes();
}
</script>

<template>
  <UApp>
    <UContainer class="py-10 space-y-6">
      <h1 class="text-xl font-semibold">Quotes</h1>
      <p v-if="me" class="text-sm text-muted">Signed in as {{ me.name }}</p>
      <UAlert v-if="meError" color="error" title="Could not load the current user." />

      <UForm :schema="addQuoteRequest" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField label="Quote" name="text">
          <UInput v-model="state.text" placeholder="Never cross; always Common." />
        </UFormField>
        <UFormField label="Author" name="author">
          <UInput v-model="state.author" placeholder="Meridian doctrine" />
        </UFormField>
        <UButton type="submit">Add quote</UButton>
        <UAlert v-if="serverError" color="error" :title="serverError" />
      </UForm>

      <ul class="space-y-2">
        <li v-for="quote in quotes" :key="quote.id">
          <blockquote>
            {{ quote.text }} — <em>{{ quote.author }}</em>
          </blockquote>
        </li>
      </ul>
    </UContainer>
  </UApp>
</template>
