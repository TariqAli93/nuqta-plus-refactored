<template>
  <div class="pos" :class="{ 'is-mobile': isMobile, 'cart-open': cartOpen }">
    <!-- ═══════════════════ Products zone ═══════════════════ -->
    <section class="pos__products" aria-label="المنتجات">
      <header class="products__toolbar">
        <!-- Shift status / open / close shift bar -->
        <div class="shift-bar">
          <template v-if="hasOpenSession">
            <v-chip size="small" color="success" variant="flat" prepend-icon="mdi-cash-register">
              وردية #{{ currentSession.id }} — افتتاحي
              {{ formatMoney(currentSession.openingCash, currentSession.currency) }}
            </v-chip>
            <span class="shift-bar__metric">
              <v-icon size="14">mdi-cash-plus</v-icon>
              مستلم: {{ formatMoney(currentSession.cashIn, currentSession.currency) }}
            </span>
            <span class="shift-bar__metric shift-bar__metric--strong">
              <v-icon size="14">mdi-scale-balance</v-icon>
              متوقع: {{ formatMoney(currentSession.expectedCash, currentSession.currency) }}
            </span>
            <v-spacer />
            <v-btn
              size="small"
              variant="outlined"
              color="warning"
              :loading="shiftLoading"
              @click="requestCloseShift"
            >
              <v-icon start size="16">mdi-cash-lock</v-icon>
              إغلاق الوردية
            </v-btn>
          </template>
          <template v-else>
            <v-chip
              size="small"
              color="warning"
              variant="flat"
              prepend-icon="mdi-alert-circle-outline"
            >
              لا توجد وردية مفتوحة
            </v-chip>
            <v-spacer />
            <v-btn
              size="small"
              color="primary"
              variant="elevated"
              :loading="shiftLoading"
              @click="openShiftDialog = true"
            >
              <v-icon start size="16">mdi-cash-register</v-icon>
              فتح وردية
            </v-btn>
          </template>
        </div>

        <div class="toolbar__row">
          <v-text-field
            ref="searchRef"
            v-model="searchInput"
            density="comfortable"
            variant="outlined"
            hide-details
            placeholder="بحث سريع (F2)"
            prepend-inner-icon="mdi-magnify"
            clearable
            @keydown.esc.prevent="searchInput = ''"
            @keydown.down.prevent="focusFirstCard"
          />
          <v-text-field
            ref="barcodeRef"
            v-model="barcode"
            density="comfortable"
            variant="outlined"
            hide-details
            placeholder="باركود (F4)"
            prepend-inner-icon="mdi-barcode-scan"
            class="barcode-input"
            @keyup.enter="onBarcode"
            @keydown.esc.prevent="barcode = ''"
          />
        </div>

        <v-slide-group show-arrows>
          <v-btn
            class="flex items-center justify-between"
            variant="elevated"
            :color="selectedCategory === null ? 'primary' : 'secondary'"
            density="default"
            @click="selectedCategory = null"
          >
            <span>الكل</span>
          </v-btn>
          <v-slide-group-item v-for="c in categoriesWithCounts" :key="c.id">
            <v-divider vertical class="mx-2" />

            <v-btn
              variant="elevated"
              :color="selectedCategory === c.id ? 'primary' : 'secondary'"
              density="compact"
              @click="selectedCategory = c.id"
            >
              <v-spacer class="mx-1" />
              <span>{{ c.name }}</span>
              <v-spacer class="mx-1" />
              <v-chip size="small">
                {{ c.count }}
              </v-chip>
            </v-btn>
          </v-slide-group-item>
        </v-slide-group>
      </header>

      <div ref="gridRef" class="products__grid" role="grid" aria-live="polite" @keydown="onGridKey">
        <template v-if="loadingProducts">
          <div
            v-for="n in 8"
            :key="`sk-${n}`"
            class="product product--skeleton"
            aria-hidden="true"
          />
        </template>

        <div v-else-if="filteredProducts.length === 0" class="products__empty">
          <v-icon size="56" class="text-medium-emphasis">mdi-package-variant-closed</v-icon>
          <div class="text-h6 mt-2">
            {{ debouncedSearch || selectedCategory ? 'لا نتائج' : 'لا توجد منتجات' }}
          </div>
          <div class="text-body-2 text-medium-emphasis">
            {{
              debouncedSearch || selectedCategory
                ? 'جرّب تعديل البحث أو التصنيف.'
                : 'أضف منتجات من شاشة المنتجات لبدء البيع.'
            }}
          </div>
        </div>

        <button
          v-for="p in filteredProducts"
          v-else
          :key="p.id"
          v-memo="[p.id, availableOf(p), p.sellingPrice, p.name, isFeatured(p)]"
          class="product"
          :class="{
            'product--out': availableOf(p) <= 0,
            'product--featured': isFeatured(p),
          }"
          :disabled="availableOf(p) <= 0"
          :title="p.name"
          :tabindex="availableOf(p) <= 0 ? -1 : 0"
          role="gridcell"
          @click="addProduct(p)"
          @keydown.enter.prevent="addProduct(p)"
          @keydown.space.prevent="addProduct(p)"
        >
          <span v-if="isFeatured(p)" class="product__badge" aria-label="مميّز">
            <v-icon size="14">mdi-star</v-icon>
          </span>
          <div class="product__name">{{ p.name }}</div>
          <div v-if="p.category" class="product__cat">{{ p.category }}</div>
          <div class="product__foot">
            <span class="product__price">{{ formatMoney(p.sellingPrice, p.currency) }}</span>
            <span class="product__stock" :class="stockClass(p)">{{ availableOf(p) }}</span>
          </div>
        </button>
      </div>

      <!-- Numpad / pay area -->
      <div class="numpad bg-surface-soft rounded-lg p-3">
        <div class="numpad__readout" :class="changeStateClass">
          <div class="numpad__readout-top">
            <span class="numpad__readout-label">المستلم</span>
            <span v-if="paidInput" class="numpad__readout-typed">{{ paidInput }}</span>
          </div>
          <div class="numpad__readout-value">
            {{ formatMoney(payment.paidAmount || 0, currency) }}
          </div>
          <div class="numpad__delta">
            <v-icon size="14">{{ changeIcon }}</v-icon>
            <span class="numpad__delta-label">{{ changeLabel }}</span>
            <span class="numpad__delta-value">{{ formatMoney(changeAmount, currency) }}</span>
          </div>
        </div>

        <div v-if="payment.method === 'card'" class="numpad__refs">
          <v-text-field
            v-model="payment.reference"
            variant="outlined"
            density="compact"
            hide-details="auto"
            label="مرجع البطاقة *"
            placeholder="رقم العملية أو الوصل"
            autocomplete="off"
            prepend-inner-icon="mdi-credit-card-outline"
          />
        </div>

        <v-divider class="my-3" />

        <v-row>
          <v-col cols="8">
            <div class="numpad__keys">
              <v-btn
                v-for="k in numpadKeys"
                :key="k.value"
                variant="elevated"
                color="secondary"
                :class="k.cls"
                :aria-label="k.aria || k.label"
                @click="onNumpad(k.value)"
              >
                <v-icon v-if="k.icon" size="22">{{ k.icon }}</v-icon>
                <span v-else>{{ k.label }}</span>
              </v-btn>
            </div>
          </v-col>
          <v-divider vertical />
          <v-col cols="4">
            <div class="grid grid-cols-1 gap-1 w-full">
              <div class="grid grid-cols-2 gap-2 w-full mb-3">
                <v-btn
                  v-for="a in quickAmounts"
                  :key="a"
                  variant="elevated"
                  color="secondary"
                  :title="`+ ${formatMoney(a, currency)}`"
                  @click="addToPaid(a)"
                >
                  <v-icon start size="18">mdi-plus</v-icon>
                  {{ shortAmount(a) }}
                </v-btn>
                <v-btn
                  variant="elevated"
                  color="primary"
                  class="numpad__util numpad__util--primary"
                  :disabled="items.length === 0"
                  @click="onFullPayment"
                >
                  <v-icon start size="18">mdi-cash-multiple</v-icon>
                  المبلغ كامل
                </v-btn>
              </div>

              <v-btn
                variant="elevated"
                color="red"
                :disabled="!paidInput"
                @click="onNumpad('clear')"
              >
                <v-icon start size="18">mdi-refresh</v-icon>
                تصفير
              </v-btn>
            </div>
          </v-col>
        </v-row>

        <v-divider class="my-3" />
        <!-- Actions -->
        <div class="pay__actions">
          <v-tooltip
            v-if="draftsVisible"
            location="top"
            :text="draftsReason"
            :disabled="!draftsDisabled"
          >
            <template #activator="{ props: tipProps }">
              <span v-bind="tipProps" class="pay__draft-wrap">
                <v-btn
                  variant="outlined"
                  size="large"
                  class="pay__draft-btn"
                  :disabled="draftsDisabled || items.length === 0 || submitting"
                  @click="onHold"
                >
                  <v-icon start size="18">mdi-content-save-outline</v-icon>
                  مسودة
                </v-btn>
              </span>
            </template>
          </v-tooltip>
          <v-btn
            size="large"
            color="primary"
            class="pay__checkout"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="checkout"
          >
            <v-icon start size="18">mdi-check-circle-outline</v-icon>
            دفع وإتمام
            <span class="pay__hotkey">F9</span>
          </v-btn>
        </div>
      </div>
    </section>

    <!-- ═══════════════════ Cart zone ═══════════════════ -->
    <aside class="pos__cart" :class="{ 'is-open': cartOpen }" aria-label="السلة">
      <div v-if="isMobile" class="cart__handle" @click="cartOpen = false">
        <span class="cart__handle-bar" />
      </div>

      <!-- Header -->
      <header class="cart__header">
        <div class="cart__title">
          <v-icon size="18" class="cart__title-icon">mdi-cart-variant</v-icon>
          <span class="cart__title-text">السلة</span>
          <span v-if="itemCount > 0" class="cart__badge">{{ itemCount }}</span>
        </div>
        <div class="cart__header-actions">
          <button
            v-if="draftsVisible"
            type="button"
            class="cart__drafts-btn"
            :class="{ 'cart__drafts-btn--disabled': draftsDisabled }"
            :title="
              draftsDisabled
                ? draftsReason
                : `المسودات${currentDraftId ? ' — مفتوحة #' + currentDraftId : ''}`
            "
            :disabled="draftsDisabled"
            @click="openDraftsList"
          >
            <v-icon size="14">{{
              draftsDisabled ? 'mdi-lock-outline' : 'mdi-archive-clock-outline'
            }}</v-icon>
            المسودات
            <span v-if="currentDraftId && !draftsDisabled" class="cart__drafts-flag">
              #{{ currentDraftId }}
            </span>
          </button>
          <button v-if="items.length > 0" type="button" class="cart__clear" @click="confirmClear">
            <v-icon size="14">mdi-delete-sweep-outline</v-icon>
            تفريغ
          </button>
        </div>
      </header>

      <!-- Lines -->
      <div class="cart__lines" aria-live="polite">
        <div v-if="items.length === 0" class="cart__empty">
          <div class="cart__empty-icon-wrap">
            <v-icon size="40" class="cart__empty-icon">mdi-cart-outline</v-icon>
          </div>
          <div class="cart__empty-title">السلة فارغة</div>
          <div class="cart__empty-sub">اختر منتجاً أو امسح باركود لبدء البيع.</div>
          <div class="cart__hints">
            <span class="cart__hint"><kbd>F2</kbd> بحث</span>
            <span class="cart__hint"><kbd>F4</kbd> باركود</span>
            <span class="cart__hint"><kbd>F9</kbd> دفع</span>
          </div>
        </div>

        <TransitionGroup v-else name="line-anim" tag="ul" class="cart__lines-list">
          <li
            v-for="item in items"
            :key="item.id"
            class="line"
            :class="{ 'line--flash': flashItemId === item.id }"
          >
            <button
              type="button"
              class="line__remove"
              :aria-label="`إزالة ${item.name}`"
              @click.stop="removeItem(item.id)"
            >
              <v-icon size="14">mdi-close</v-icon>
            </button>

            <div class="line__main" role="button" tabindex="0">
              <div class="line__name" :title="item.name">
                <span>{{ item.name }}</span>
                <div class="flex-row gap-1">
                  <v-btn
                    variant="text"
                    size="x-small"
                    color="primary"
                    @click.stop="openLineEdit(item)"
                    @keydown.enter.stop="openLineEdit(item)"
                  >
                    <v-icon>mdi-dots-vertical</v-icon>
                  </v-btn>
                  <v-btn
                    variant="text"
                    size="x-small"
                    color="error"
                    @click.stop="removeItem(item.id)"
                    @keydown.enter.stop="removeItem(item.id)"
                  >
                    <v-icon>mdi-trash-can-outline</v-icon>
                  </v-btn>
                </div>
              </div>
              <div class="line__meta">
                <span class="line__unit">
                  {{ formatMoney(Math.max(0, item.price - item.discount), currency) }}
                </span>
                <span class="line__sep">·</span>
                <span class="line__unit-label">للوحدة</span>
                <span v-if="item.discount > 0" class="line__chip line__chip--warning">
                  <v-icon size="10">mdi-tag-outline</v-icon>
                  خصم
                </span>
                <span v-if="item.note" class="line__chip line__chip--note" :title="item.note">
                  <v-icon size="10">mdi-note-text-outline</v-icon>
                  {{ truncate(item.note, 14) }}
                </span>
              </div>
            </div>

            <div class="line__bottom">
              <div class="line__qty" @click.stop>
                <button
                  type="button"
                  class="line__qty-btn"
                  aria-label="إنقاص"
                  @click="decQty(item.id)"
                >
                  <v-icon size="14">mdi-minus</v-icon>
                </button>
                <input
                  :value="item.qty"
                  type="number"
                  :min="1"
                  class="line__qty-input"
                  inputmode="numeric"
                  @click.stop
                  @blur="(e) => commitQty(item.id, e.target.value)"
                  @keyup.enter="
                    (e) => {
                      commitQty(item.id, e.target.value);
                      e.target.blur();
                    }
                  "
                />
                <button
                  type="button"
                  class="line__qty-btn"
                  aria-label="زيادة"
                  @click="incQty(item.id)"
                >
                  <v-icon size="14">mdi-plus</v-icon>
                </button>
              </div>

              <div class="line__total">
                {{ formatMoney(lineSubtotal(item), currency) }}
              </div>
            </div>
          </li>
        </TransitionGroup>
      </div>

      <!-- Total summary -->
      <div class="cart__total">
        <div v-if="discountValue > 0 || taxValue > 0" class="cart__total-rows">
          <div class="cart__total-row">
            <span class="cart__total-row-label">المجموع الفرعي</span>
            <span class="cart__total-row-val">{{ formatMoney(subtotal, currency) }}</span>
          </div>
          <div v-if="discountValue > 0" class="cart__total-row cart__total-row--warning">
            <span class="cart__total-row-label">الخصم</span>
            <span class="cart__total-row-val">− {{ formatMoney(discountValue, currency) }}</span>
          </div>
          <div v-if="taxValue > 0" class="cart__total-row">
            <span class="cart__total-row-label">الضريبة (%{{ tax.value }})</span>
            <span class="cart__total-row-val">{{ formatMoney(taxValue, currency) }}</span>
          </div>
        </div>

        <div class="cart__total-main">
          <span class="cart__total-label">الإجمالي</span>
          <span class="cart__total-value">{{ formatMoney(total, currency) }}</span>
        </div>

        <v-divider class="my-3" />

        <div class="cart__adjustments">
          <div class="adj__row">
            <v-number-input
              v-model.number="saleDiscount.value"
              type="number"
              :min="0"
              variant="outlined"
              density="compact"
              hide-details
              control-variant="split"
              label="خصم"
            >
              <template #prepend>
                <v-btn
                  :variant="saleDiscount.type === 'amount' ? 'elevated' : 'text'"
                  size="x-small"
                  color="primary"
                  @click="saleDiscount.type = 'amount'"
                  @keydown.enter.stop="saleDiscount.type = 'amount'"
                >
                  <v-icon size="14">mdi-cash</v-icon>
                </v-btn>
                <v-btn
                  :variant="saleDiscount.type === 'percent' ? 'elevated' : 'text'"
                  size="x-small"
                  color="primary"
                  @click="saleDiscount.type = 'percent'"
                  @keydown.enter.stop="saleDiscount.type = 'percent'"
                >
                  <v-icon size="14">mdi-percent</v-icon>
                </v-btn>
              </template>
            </v-number-input>
          </div>
          <div class="adj__row">
            <v-number-input
              v-model.number="tax.value"
              type="number"
              :min="0"
              variant="outlined"
              density="compact"
              hide-details
              control-variant="split"
              label="ضريبة"
              :readonly="!tax.enabled"
            >
              <template #prepend>
                <v-switch v-model="tax.enabled" density="compact" color="primary" hide-details />
              </template>
            </v-number-input>
          </div>
        </div>

        <v-divider class="my-3" />

        <!-- Payment methods -->
        <div class="pay__methods" role="radiogroup" aria-label="طريقة الدفع">
          <button
            v-for="m in paymentMethods"
            :key="m.value"
            type="button"
            class="pay__method"
            :class="{ active: payment.method === m.value }"
            role="radio"
            :aria-checked="payment.method === m.value"
            @click="onMethodChange(m.value)"
          >
            <v-icon size="22">{{ m.icon }}</v-icon>
            <span>{{ m.label }}</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- ═══════════════════ Overlays ═══════════════════ -->
    <div v-if="isMobile && cartOpen" class="pos__backdrop" @click="cartOpen = false" />

    <!-- Line edit dialog (per-unit discount + note) -->
    <v-dialog v-model="lineEditOpen" max-width="440">
      <v-card v-if="lineEditItem" class="line-edit bg-surface-soft rounded-lg p-3">
        <v-card-title class="line-edit__title">
          <div class="line-edit__name">{{ lineEditItem.name }}</div>
          <div class="line-edit__price text-caption text-medium-emphasis">
            السعر: {{ formatMoney(lineEditItem.price, currency) }}
          </div>
        </v-card-title>
        <v-card-text class="line-edit__body">
          <v-text-field
            v-model.number="lineEditDraft.discount"
            type="number"
            :min="0"
            label="خصم / وحدة"
            variant="outlined"
            density="comfortable"
            hide-details
            :max="lineEditItem.price"
          />
          <v-text-field
            v-model="lineEditDraft.note"
            label="ملاحظة"
            variant="outlined"
            density="comfortable"
            hide-details
            autofocus
          />
        </v-card-text>
        <v-card-actions class="line-edit__actions">
          <v-btn variant="text" @click="lineEditOpen = false">إلغاء</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="saveLineEdit">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      v-model="clearDialog"
      title="تفريغ السلة"
      message="هل تريد إزالة كل المنتجات من السلة؟"
      type="warning"
      confirm-text="تفريغ"
      cancel-text="إلغاء"
      @confirm="clear"
    />

    <!-- Drafts list dialog (POS-compatible drafts only) -->
    <v-dialog v-model="draftsOpen" max-width="640" scrollable>
      <v-card class="drafts bg-surface-soft rounded-lg">
        <v-card-title class="drafts__title">
          <div class="drafts__title-row">
            <v-icon size="22">mdi-archive-clock-outline</v-icon>
            <span>المسودات (POS)</span>
            <v-spacer />
            <v-btn
              icon="mdi-refresh"
              variant="text"
              size="small"
              :loading="draftsLoading"
              :title="'تحديث'"
              @click="loadDrafts"
            />
          </div>
          <v-text-field
            v-model="draftsSearch"
            density="comfortable"
            variant="outlined"
            hide-details
            clearable
            placeholder="بحث برقم الفاتورة أو اسم العميل"
            prepend-inner-icon="mdi-magnify"
            class="mt-2"
          />
        </v-card-title>

        <v-card-text class="drafts__body">
          <div v-if="draftsLoading && draftList.length === 0" class="drafts__state">
            <v-progress-circular indeterminate color="primary" />
            <div class="text-medium-emphasis mt-2">جاري التحميل…</div>
          </div>
          <div v-else-if="draftsError" class="drafts__state">
            <v-icon size="40" color="error">mdi-alert-circle-outline</v-icon>
            <div class="text-body-2 mt-2">{{ draftsError }}</div>
            <v-btn class="mt-3" variant="outlined" size="small" @click="loadDrafts">
              <v-icon start size="16">mdi-refresh</v-icon>
              إعادة المحاولة
            </v-btn>
          </div>
          <div v-else-if="filteredDrafts.length === 0" class="drafts__state">
            <v-icon size="40" class="text-medium-emphasis">mdi-tray-remove</v-icon>
            <div class="text-body-2 text-medium-emphasis mt-2">
              {{ draftsSearch ? 'لا توجد مسودات مطابقة' : 'لا توجد مسودات للـ POS' }}
            </div>
          </div>
          <ul v-else class="drafts__list">
            <li v-for="d in filteredDrafts" :key="d.id" class="drafts__item">
              <div class="drafts__item-main">
                <div class="drafts__item-head">
                  <span class="drafts__item-inv">{{ d.invoiceNumber || `#${d.id}` }}</span>
                  <span class="drafts__item-total">
                    {{ formatMoney(d.total, d.currency) }}
                  </span>
                </div>
                <div class="drafts__item-meta">
                  <span class="drafts__item-meta-cell">
                    <v-icon size="14">mdi-account-outline</v-icon>
                    {{ d.customer || 'بدون عميل' }}
                  </span>
                  <span class="drafts__item-meta-cell">
                    <v-icon size="14">mdi-package-variant-closed</v-icon>
                    {{ d.itemCount ?? 0 }} عنصر
                  </span>
                  <span class="drafts__item-meta-cell">
                    <v-icon size="14">mdi-clock-outline</v-icon>
                    {{ formatDraftDate(d.createdAt) }}
                  </span>
                </div>
              </div>
              <div class="drafts__item-actions">
                <v-btn
                  variant="flat"
                  color="primary"
                  size="small"
                  :loading="continuingDraftId === d.id"
                  :disabled="!!continuingDraftId || deletingDraftId === d.id"
                  @click="continueDraft(d)"
                >
                  <v-icon start size="16">mdi-play-circle-outline</v-icon>
                  متابعة
                </v-btn>
                <v-btn
                  variant="text"
                  color="error"
                  size="small"
                  :loading="deletingDraftId === d.id"
                  :disabled="!!continuingDraftId || !!deletingDraftId"
                  @click="askDeleteDraft(d)"
                >
                  <v-icon size="18">mdi-trash-can-outline</v-icon>
                </v-btn>
              </div>
            </li>
          </ul>
        </v-card-text>

        <v-card-actions class="drafts__actions">
          <v-spacer />
          <v-btn variant="text" @click="draftsOpen = false">إغلاق</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      v-model="draftDeleteDialog"
      title="حذف المسودة"
      :message="
        draftPendingDelete
          ? `هل تريد حذف المسودة ${draftPendingDelete.invoiceNumber || '#' + draftPendingDelete.id}؟`
          : ''
      "
      type="warning"
      confirm-text="حذف"
      cancel-text="إلغاء"
      @confirm="confirmDeleteDraft"
    />

    <ConfirmDialog
      v-model="draftReplaceDialog"
      title="استبدال السلة الحالية"
      message="السلة الحالية تحتوي عناصر. هل تريد تفريغها وتحميل المسودة؟"
      type="warning"
      confirm-text="استبدال"
      cancel-text="إلغاء"
      @confirm="confirmReplaceWithDraft"
    />

    <!-- Cash session: open/close shift dialogs -->
    <OpenShiftDialog
      v-model="openShiftDialog"
      :loading="shiftLoading"
      :default-currency="currency"
      :cancelable="hasOpenSession"
      @confirm="onOpenShiftConfirm"
      @cancel="openShiftDialog = false"
    />
    <CloseShiftDialog
      v-model="closeShiftDialog"
      :loading="shiftLoading"
      :session="currentSession"
      @confirm="onCloseShiftConfirm"
      @cancel="closeShiftDialog = false"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useDisplay } from 'vuetify';
import {
  useProductStore,
  useCategoryStore,
  useInventoryStore,
  useSettingsStore,
  useNotificationStore,
  useSaleStore,
} from '@/stores';
import { useCashSessionStore } from '@/stores/cashSession';
import { usePosCart } from '@/composables/usePosCart';
import { useFeatureGate } from '@/composables/useFeatureGate';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import OpenShiftDialog from '@/components/cashSession/OpenShiftDialog.vue';
import CloseShiftDialog from '@/components/cashSession/CloseShiftDialog.vue';
import api from '@/plugins/axios';

// ── Stores ──────────────────────────────────────────────────────────────────
const productStore = useProductStore();
const categoryStore = useCategoryStore();
const inventoryStore = useInventoryStore();
const settingsStore = useSettingsStore();
const notify = useNotificationStore();
const saleStore = useSaleStore();
const cashSessionStore = useCashSessionStore();

// Capability-driven UI: the "save as draft" button is only meaningful when
// the draftInvoices module is enabled AND the user has the capability.
// We split the check so that users who hold the capability still see the
// button — disabled with a tooltip — when only the feature flag is off.
const draftsGate = useFeatureGate('draftInvoices', 'canUseDraftInvoices');
const canUseDrafts = computed(() => draftsGate.enabled.value);
const draftsVisible = draftsGate.visible;
const draftsDisabled = draftsGate.disabled;
const draftsReason = draftsGate.reason;
const router = useRouter();
const route = useRoute();

// Tracks the draft id we resumed from, so checkout can complete it instead of
// creating a brand-new sale (and leaving the draft orphaned in the DB).
const currentDraftId = ref(null);

// ── Cash session / shift state ─────────────────────────────────────────────
// `currentSession` mirrors the open shift for the acting user. The POS cannot
// record cash sales without one, so we surface explicit Open/Close dialogs.
const openShiftDialog = ref(false);
const closeShiftDialog = ref(false);
const shiftLoading = ref(false);
const currentSession = computed(() => cashSessionStore.current);
const hasOpenSession = computed(() => cashSessionStore.hasOpenSession);

const refreshCurrentSession = async () => {
  await cashSessionStore.fetchCurrent();
};

const onOpenShiftConfirm = async ({ openingCash, currency: cur, notes }) => {
  shiftLoading.value = true;
  try {
    // Carry the cashier's active branch through so the session row stores
    // a real branch_id (instead of NULL) for global / unassigned admins.
    await cashSessionStore.openSession({
      openingCash,
      currency: cur,
      notes,
      branchId: inventoryStore.selectedBranchId || null,
    });
    openShiftDialog.value = false;
  } catch {
    /* notification already raised by the store */
  } finally {
    shiftLoading.value = false;
  }
};

const onCloseShiftConfirm = async ({ closingCash, notes }) => {
  if (!currentSession.value?.id) return;
  shiftLoading.value = true;
  try {
    await cashSessionStore.closeSession(currentSession.value.id, { closingCash, notes });
    closeShiftDialog.value = false;
  } catch {
    /* notification already raised by the store */
  } finally {
    shiftLoading.value = false;
  }
};

const requestCloseShift = async () => {
  // Refresh totals before showing the dialog so the cashier sees the latest
  // expectedCash figure (newly recorded sales since they last looked).
  await refreshCurrentSession();
  if (!hasOpenSession.value) {
    openShiftDialog.value = true;
    return;
  }
  closeShiftDialog.value = true;
};

const { mobile: isMobile } = useDisplay();

// ── Cart composable ────────────────────────────────────────────────────────
// Day-to-day POS: no customer, no instalments — anonymous cash/card sales.
const {
  currency,
  items,
  saleDiscount,
  tax,
  payment,
  submitting,

  subtotal,
  discountValue,
  taxValue,
  total,
  change,
  remaining,
  itemCount,
  canSubmit,
  lineSubtotal,

  addItem,
  removeItem,
  updateQty,
  incQty,
  decQty,
  updateLineDiscount,
  updateLineNote,
  clear,
  applyExact,
  addToPaid,
  setPaid,
  submit,
  holdAsDraft,
  loadDraft,
} = usePosCart();

// ── Local UI state ─────────────────────────────────────────────────────────
const searchInput = ref('');
const debouncedSearch = ref('');
const barcode = ref('');
const selectedCategory = ref(null);
const products = ref([]);
const categories = ref([]);
const loadingProducts = ref(false);
const cartOpen = ref(false);
const clearDialog = ref(false);

// Numpad: a free-typed string we own as the source of truth for the readout.
// Sync to/from payment.paidAmount so applyExact / addToPaid still drive it.
const paidInput = ref('');

watch(
  () => payment.paidAmount,
  (v) => {
    const cur = parseFloat(paidInput.value);
    if (Number.isFinite(cur) && cur === Number(v)) return;
    paidInput.value = Number(v) > 0 ? String(v) : '';
  }
);

// Per-line edit dialog state
const lineEditOpen = ref(false);
const lineEditItem = ref(null);
const lineEditDraft = reactive({ discount: 0, note: '' });

// ── Drafts list dialog state ─────────────────────────────────────────────
// Listing is restricted to POS-compatible (cash) drafts; installment drafts
// stay handled by NewSale.vue and never appear here.
const draftsOpen = ref(false);
const draftsLoading = ref(false);
const draftsError = ref('');
const draftList = ref([]);
const draftsSearch = ref('');
const continuingDraftId = ref(null);
const deletingDraftId = ref(null);
const draftDeleteDialog = ref(false);
const draftPendingDelete = ref(null);
const draftReplaceDialog = ref(false);
const draftPendingLoad = ref(null);

// Flash effect: highlights a cart line when it's newly added or its qty grew —
// gives the cashier positive confirmation that their click/scan landed.
const flashItemId = ref(null);
const lastLineQty = new Map();
let flashTimer = null;

watch(
  items,
  (curr) => {
    let flashId = null;
    for (const it of curr) {
      const prevQty = lastLineQty.get(it.id);
      if (prevQty === undefined || it.qty > prevQty) flashId = it.id;
    }
    lastLineQty.clear();
    for (const it of curr) lastLineQty.set(it.id, it.qty);

    if (flashId) {
      flashItemId.value = flashId;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        if (flashItemId.value === flashId) flashItemId.value = null;
      }, 900);
    }
  },
  { deep: true, flush: 'post' }
);

const truncate = (s, n) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

const searchRef = ref(null);
const barcodeRef = ref(null);
const gridRef = ref(null);

let searchTimer = null;
watch(searchInput, (v) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedSearch.value = (v || '').trim().toLowerCase();
  }, 120);
});

// ── Payment UI config ──────────────────────────────────────────────────────
const paymentMethods = [
  { value: 'cash', label: 'نقداً', icon: 'mdi-cash' },
  { value: 'card', label: 'بطاقة', icon: 'mdi-credit-card-outline' },
];

const quickAmounts = computed(() =>
  currency.value === 'USD' ? [1, 5, 10, 20, 50, 100] : [1000, 5000, 10000, 25000, 50000]
);

// Numpad keys depend on currency: IQD gets "00" instead of "."
const numpadKeys = computed(() => {
  const digits = ['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((v) => ({
    value: v,
    label: v,
  }));
  const last =
    currency.value === 'USD'
      ? [
          { value: '.', label: '.' },
          { value: '0', label: '0' },
          {
            value: 'back',
            icon: 'mdi-backspace-outline',
            cls: 'numpad__key--util',
            aria: 'مسح حرف',
          },
        ]
      : [
          { value: '00', label: '00' },
          { value: '0', label: '0' },
          {
            value: 'back',
            icon: 'mdi-backspace-outline',
            cls: 'numpad__key--util',
            aria: 'مسح حرف',
          },
        ];
  return [...digits, ...last];
});

const onNumpad = (key) => {
  if (key === 'clear') {
    paidInput.value = '';
    setPaid(0);
    return;
  }
  if (key === 'back') {
    paidInput.value = paidInput.value.slice(0, -1);
    setPaid(parseFloat(paidInput.value) || 0);
    return;
  }
  if (key === '.') {
    if (paidInput.value.includes('.')) return;
    paidInput.value = paidInput.value ? paidInput.value + '.' : '0.';
    return; // no setPaid yet — trailing dot doesn't change numeric value
  }
  if (key === '00') {
    if (!paidInput.value) return; // skip leading zeros
    paidInput.value += '00';
    setPaid(parseFloat(paidInput.value) || 0);
    return;
  }
  // Digit
  paidInput.value = (paidInput.value || '') + key;
  setPaid(parseFloat(paidInput.value) || 0);
};

const onFullPayment = () => {
  applyExact();
  // The watcher on payment.paidAmount syncs paidInput automatically.
};

// Card sales are normally paid in full at point of swipe — auto-fill exact
// when the cashier switches to card so they don't have to re-type.
const onMethodChange = (m) => {
  payment.method = m;
  if (m === 'card' && total.value > 0 && payment.paidAmount !== total.value) {
    applyExact();
  }
};

// ── Derived product helpers ────────────────────────────────────────────────
const availableOf = (p) => Number(p?.warehouseStock ?? p?.totalStock ?? p?.stock ?? 0) || 0;

const stockClass = (p) => {
  const q = availableOf(p);
  if (q <= 0) return 'stock-out';
  const threshold =
    p.lowStockThreshold && p.lowStockThreshold > 0 ? p.lowStockThreshold : p.minStock || 0;
  if (q <= threshold) return 'stock-low';
  return 'stock-ok';
};

const isFeatured = (p) => Boolean(p?.isFeatured || p?.isBestSeller || p?.featured || p?.bestseller);

const filteredProducts = computed(() => {
  const q = debouncedSearch.value;
  const catId = selectedCategory.value;
  if (!q && !catId) return products.value;

  return products.value.filter((p) => {
    if (catId != null && p.categoryId !== catId) return false;
    if (!q) return true;
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
  });
});

const categoriesWithCounts = computed(() => {
  const counts = new Map();
  for (const p of products.value) {
    if (p.categoryId == null) continue;
    counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);
  }
  return categories.value
    .map((c) => ({ ...c, count: counts.get(c.id) || 0 }))
    .filter((c) => c.count > 0);
});

// ── Payment derivations ────────────────────────────────────────────────────
const changeAmount = computed(() => (change.value > 0 ? change.value : remaining.value));
const changeLabel = computed(() => {
  if (change.value > 0) return 'الباقي';
  if (remaining.value > 0) return 'المستحق';
  return 'التعادل';
});
const changeIcon = computed(() => {
  if (change.value > 0) return 'mdi-cash-refund';
  if (remaining.value > 0) return 'mdi-alert-circle-outline';
  return 'mdi-check-circle-outline';
});
const changeStateClass = computed(() => {
  if (change.value > 0) return 'is-success';
  if (remaining.value > 0) return 'is-error';
  if (payment.paidAmount > 0) return 'is-neutral';
  return '';
});

// ── Formatting ─────────────────────────────────────────────────────────────
const formatMoney = (value, cur) => {
  const n = Number(value || 0);
  const c = cur || currency.value;
  return `${n.toLocaleString('en-US', {
    maximumFractionDigits: c === 'USD' ? 2 : 0,
  })} ${c}`;
};

// Compact label for quick-add chips (e.g., 1k, 10k, 1M).
const shortAmount = (a) => {
  if (a >= 1_000_000) return `${a / 1_000_000}M`;
  if (a >= 1_000) return `${a / 1_000}k`;
  return String(a);
};

// ── Data load ──────────────────────────────────────────────────────────────
const loadProducts = async () => {
  loadingProducts.value = true;
  try {
    const response = await productStore.fetch({
      limit: 1000,
      warehouseId: inventoryStore.selectedWarehouseId || undefined,
    });
    products.value = response?.data || [];
  } finally {
    loadingProducts.value = false;
  }
};

const loadCategories = async () => {
  try {
    const response = await categoryStore.fetchCategories();
    categories.value = response?.data || [];
  } catch {
    categories.value = [];
  }
};

watch(() => inventoryStore.selectedWarehouseId, loadProducts);

// ── Cart interactions ──────────────────────────────────────────────────────
const addProduct = (product) => {
  if (availableOf(product) <= 0) return;
  addItem(product);
};

const commitQty = (id, raw) => {
  updateQty(id, raw);
};

const onBarcode = () => {
  const code = barcode.value.trim();
  if (!code) return;
  const match = products.value.find((p) => p.barcode === code || p.sku === code);
  if (!match) {
    notify.error('لا يوجد منتج بهذا الرمز');
    return;
  }
  addItem(match, 1);
  barcode.value = '';
  nextTick(() => barcodeRef.value?.focus?.());
};

const openLineEdit = (item) => {
  lineEditItem.value = item;
  lineEditDraft.discount = Number(item.discount) || 0;
  lineEditDraft.note = String(item.note || '');
  lineEditOpen.value = true;
};

const saveLineEdit = () => {
  const item = lineEditItem.value;
  if (!item) return;
  updateLineDiscount(item.id, lineEditDraft.discount);
  updateLineNote(item.id, lineEditDraft.note);
  lineEditOpen.value = false;
};

const checkout = async () => {
  if (!canSubmit.value) return;
  // Cash POS sales require an open shift. Card sales bypass this check —
  // the drawer doesn't move on a card transaction.
  const isCashSale = payment.method === 'cash' && Number(payment.paidAmount) > 0;
  if (isCashSale && !hasOpenSession.value) {
    notify.warning('افتح وردية قبل تسجيل بيع نقدي');
    openShiftDialog.value = true;
    return;
  }
  try {
    const sale = await submit();
    // If we resumed a draft, remove it now that a real sale has replaced it.
    // Failure here is non-fatal: the sale already succeeded.
    if (currentDraftId.value) {
      try {
        await saleStore.removeSale(currentDraftId.value);
      } catch (e) {
        console.error('Failed to clean up resumed draft:', e);
      }
      currentDraftId.value = null;
    }
    // Refresh shift totals so the header chip reflects the new cash-in.
    refreshCurrentSession();
    if (sale?.id) {
      notify.success('تم حفظ البيع بنجاح');
      clear();
      paidInput.value = '';
      router.push({ name: 'SaleDetails', params: { id: sale.id } });
      return;
    }
    notify.success('تم حفظ البيع');
    clear();
    paidInput.value = '';
  } catch (err) {
    notify.error(err?.message || 'فشل إتمام البيع');
  }
};

const onHold = async () => {
  try {
    // Resuming an existing draft? Drop the old row first so we don't fork it
    // into two competing drafts when the cashier saves again.
    if (currentDraftId.value) {
      try {
        await saleStore.removeSale(currentDraftId.value);
      } catch (e) {
        console.error('Failed to remove previous draft:', e);
      }
      currentDraftId.value = null;
    }
    const draft = await holdAsDraft();
    if (draft) {
      notify.success('تم حفظ المسودة');
      clear();
      paidInput.value = '';
    }
  } catch (err) {
    notify.error(err?.message || 'فشل حفظ المسودة');
  }
};

const confirmClear = () => {
  clearDialog.value = true;
};

// ── Drafts list ──────────────────────────────────────────────────────────
// Display only cash/POS drafts. Installment drafts stay in NewSale.vue.
// Listing endpoint already enforces branch scope server-side, so we do not
// need to refilter by branch in the client.
const isPosCompatibleDraft = (d) => {
  if (!d || d.status !== 'draft') return false;
  const pt = String(d.paymentType || '').toLowerCase();
  return pt === '' || pt === 'cash';
};

const loadDrafts = async () => {
  if (!canUseDrafts.value) return;
  draftsLoading.value = true;
  draftsError.value = '';
  try {
    // Hit the API directly — the saleStore.fetch helper would clobber the
    // shared `sales` cache and surface a toast that we already render inline.
    const response = await api.get('/sales', {
      params: { status: 'draft', paymentType: 'cash', limit: 100 },
    });
    const rows = response?.data || [];
    // Defensive: re-filter client-side in case the backend returns
    // mixed/installment drafts (older data, race with API change, etc.).
    draftList.value = rows.filter(isPosCompatibleDraft);
  } catch (err) {
    // The axios interceptor rejects with either the response body or the
    // original error, so check both shapes for a usable message.
    console.error('Failed to load drafts:', err);
    draftsError.value = err?.message || err?.response?.data?.message || 'فشل تحميل المسودات';
    draftList.value = [];
  } finally {
    draftsLoading.value = false;
  }
};

const openDraftsList = () => {
  draftsOpen.value = true;
  loadDrafts();
};

const filteredDrafts = computed(() => {
  const q = (draftsSearch.value || '').trim().toLowerCase();
  if (!q) return draftList.value;
  return draftList.value.filter((d) => {
    const inv = String(d.invoiceNumber || '').toLowerCase();
    const cus = String(d.customer || '').toLowerCase();
    return inv.includes(q) || cus.includes(q);
  });
});

const formatDraftDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Hydrate the cart from a draft already loaded in the list. Mirrors the
// route-driven `hydrateFromDraft`, but works in-place from the modal so the
// cashier can switch drafts without leaving the screen.
const applyDraftToCart = async (draftRow) => {
  continuingDraftId.value = draftRow.id;
  try {
    const response = await saleStore.fetchSale(draftRow.id);
    const draft = response?.data?.data || response?.data || response || null;
    if (!draft || draft.status !== 'draft') {
      notify.error('المسودة غير صالحة');
      return;
    }
    if (!isPosCompatibleDraft(draft)) {
      // Installment / non-cash drafts must be edited in NewSale.
      notify.warning('هذه المسودة بالأقساط — تابعها من شاشة بيع جديد');
      return;
    }
    // Restore payment method/reference if available on the draft items list
    // record (paymentMethod is not on the sale row itself but the composable
    // restores cart-level fields; method defaults to 'cash' which matches POS).
    const ok = loadDraft(draft, products.value);
    if (!ok) {
      notify.error('تعذر تحميل المسودة');
      return;
    }
    currentDraftId.value = draft.id;
    paidInput.value = '';
    notify.success('تم تحميل المسودة');
    draftsOpen.value = false;
  } catch (err) {
    console.error('Failed to continue draft:', err);
    notify.error(err?.response?.data?.message || 'فشل تحميل المسودة');
  } finally {
    continuingDraftId.value = null;
  }
};

const continueDraft = (draftRow) => {
  if (!isPosCompatibleDraft(draftRow)) {
    notify.warning('مسودة غير متوافقة مع الـ POS');
    return;
  }
  if (items.length > 0) {
    // Don't silently clobber an in-progress cart — confirm first.
    draftPendingLoad.value = draftRow;
    draftReplaceDialog.value = true;
    return;
  }
  applyDraftToCart(draftRow);
};

const confirmReplaceWithDraft = async () => {
  const target = draftPendingLoad.value;
  draftPendingLoad.value = null;
  if (!target) return;
  // Reset cart state first so loadDraft (which bails on non-empty cart) runs.
  clear();
  paidInput.value = '';
  await applyDraftToCart(target);
};

const askDeleteDraft = (draftRow) => {
  draftPendingDelete.value = draftRow;
  draftDeleteDialog.value = true;
};

const confirmDeleteDraft = async () => {
  const target = draftPendingDelete.value;
  draftPendingDelete.value = null;
  if (!target) return;
  deletingDraftId.value = target.id;
  try {
    await saleStore.removeSale(target.id);
    draftList.value = draftList.value.filter((d) => d.id !== target.id);
    if (currentDraftId.value === target.id) currentDraftId.value = null;
  } catch (err) {
    console.error('Failed to delete draft:', err);
    // saleStore already surfaces a notification for delete failures.
  } finally {
    deletingDraftId.value = null;
  }
};

// ── Keyboard: global shortcuts ─────────────────────────────────────────────
const isEditable = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

const onKeydown = (e) => {
  if (e.key === 'F2') {
    e.preventDefault();
    searchRef.value?.focus?.();
    return;
  }
  if (e.key === 'F4') {
    e.preventDefault();
    barcodeRef.value?.focus?.();
    return;
  }
  if (e.key === 'F9' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
    e.preventDefault();
    checkout();
    return;
  }
  if (isEditable(e.target)) return;
};

// ── Keyboard: grid roving focus ────────────────────────────────────────────
const focusFirstCard = () => {
  const first = gridRef.value?.querySelector('.product:not([disabled])');
  if (first) first.focus();
};

const gridCols = () => {
  const grid = gridRef.value;
  if (!grid) return 1;
  const tmpl = getComputedStyle(grid).gridTemplateColumns;
  return Math.max(1, tmpl.split(' ').filter(Boolean).length);
};

const onGridKey = (e) => {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;

  const cards = Array.from(gridRef.value?.querySelectorAll('.product:not([disabled])') || []);
  if (cards.length === 0) return;

  const current = document.activeElement;
  let idx = cards.indexOf(current);
  if (idx < 0) idx = 0;

  const cols = gridCols();
  let next = idx;

  switch (e.key) {
    case 'ArrowLeft':
      next = idx + 1;
      break;
    case 'ArrowRight':
      next = idx - 1;
      break;
    case 'ArrowDown':
      next = idx + cols;
      break;
    case 'ArrowUp':
      next = idx - cols;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = cards.length - 1;
      break;
  }

  if (next < 0 || next >= cards.length) return;
  e.preventDefault();
  cards[next]?.focus();
};

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();

  await Promise.all([loadProducts(), loadCategories()]);

  try {
    const settings = await settingsStore.fetchCurrencySettings();
    if (settings?.defaultCurrency) currency.value = settings.defaultCurrency;
  } catch {
    /* keep default */
  }

  await hydrateFromDraft();

  // Cash session: load the user's open shift; if there isn't one, surface
  // the Open Shift dialog before the cashier tries to ring up a sale.
  await refreshCurrentSession();
  if (!hasOpenSession.value) {
    openShiftDialog.value = true;
  }

  window.addEventListener('keydown', onKeydown);
  nextTick(() => barcodeRef.value?.focus?.());
});

// Resume a cash/card draft into the POS cart. Installment drafts are routed
// to NewSale, so anything that lands here should be a cash-style draft —
// we still validate to be defensive against stale links.
const hydrateFromDraft = async () => {
  const draftId = route.query.draftId ? Number(route.query.draftId) : null;
  if (!draftId) return;
  if (items.length > 0) return; // never clobber an in-progress cart

  try {
    const response = await saleStore.fetchSale(draftId);
    const draft = response?.data?.data || response?.data || response || null;
    if (!draft || draft.status !== 'draft') {
      notify.error('المسودة غير صالحة');
      return;
    }
    if (draft.paymentType === 'installment') {
      // Wrong screen for this draft — bounce to NewSale instead of mangling it.
      router.replace({ name: 'NewSale', query: { draftId } });
      return;
    }
    const ok = loadDraft(draft, products.value);
    if (ok) {
      currentDraftId.value = draft.id;
      notify.info('تم تحميل المسودة');
    }
  } catch (err) {
    console.error('Failed to load POS draft:', err);
    notify.error('فشل تحميل المسودة');
  }
};

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(searchTimer);
  clearTimeout(flashTimer);
});
</script>

<style scoped lang="scss">
/* ══════════════════ Design tokens (local) ══════════════════ */
.pos {
  --pos-space-1: 4px;
  --pos-space-2: 8px;
  --pos-space-3: 12px;
  --pos-space-4: 16px;
  --pos-radius-sm: 8px;
  --pos-radius-md: 12px;
  --pos-radius-lg: 16px;
  --pos-surface: rgb(var(--v-theme-surface));
  --pos-surface-soft: rgba(var(--v-theme-on-surface), 0.04);
  --pos-surface-tint: rgba(var(--v-theme-on-surface), 0.06);
  --pos-border: rgba(var(--v-theme-on-surface), 0.08);
  --pos-primary: rgb(var(--v-theme-primary));
  --pos-primary-soft: rgba(var(--v-theme-primary), 0.08);
  --pos-primary-hover: rgba(var(--v-theme-primary), 0.14);

  display: grid;
  grid-template-columns: minmax(0, 1fr) 440px;
  gap: var(--pos-space-4);
  height: calc(100vh - 120px);
  min-height: 600px;
  direction: rtl;
}

.pos__products,
.pos__cart {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--pos-surface);
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-lg);
  overflow: hidden;
}

.pos__products {
  display: grid;
  grid-template-rows: 0.2fr 1fr 0.2fr;
  gap: var(--pos-space-2);
  padding: var(--pos-space-3);
  height: 100%;
  overflow-y: auto;
}

/* ══════════════════ Products toolbar ══════════════════ */
.products__toolbar {
  padding: var(--pos-space-3) var(--pos-space-4) var(--pos-space-2);
  border-bottom: 1px solid var(--pos-border);
  background: var(--pos-surface);
  position: sticky;
  top: 0;
  z-index: 2;
}

.toolbar__row {
  display: flex;
  gap: var(--pos-space-2);
  align-items: center;
  margin-bottom: var(--pos-space-2);
}

.shift-bar {
  display: flex;
  align-items: center;
  gap: var(--pos-space-2);
  flex-wrap: wrap;
  margin-bottom: var(--pos-space-2);
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 0.85rem;

  &__metric {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: rgba(var(--v-theme-on-surface), 0.7);
    font-variant-numeric: tabular-nums;
    &--strong {
      color: rgb(var(--v-theme-on-surface));
      font-weight: 600;
    }
  }
}

.barcode-input {
  max-width: 220px;
}

.cart-fab {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: var(--pos-primary-soft);
  color: var(--pos-primary);
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;

  &:hover {
    background: var(--pos-primary-hover);
  }
  &.has-items {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
  }
}

.cart-fab__count {
  position: absolute;
  top: -4px;
  inset-inline-start: -4px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(var(--v-theme-error));
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.toolbar__chips {
  display: flex;
  gap: var(--pos-space-1);
  overflow-x: auto;
  padding: var(--pos-space-1) 0;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    height: 4px;
  }
}

.chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--pos-space-1);
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--pos-surface-tint);
  border: 1px solid transparent;
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
  white-space: nowrap;
  user-select: none;

  &:hover {
    background: var(--pos-primary-soft);
  }
  &.active {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
  }
  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 2px;
  }
}

.chip__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 0 6px;
  height: 18px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  font-variant-numeric: tabular-nums;
  font-size: 0.72rem;

  .chip.active & {
    background: rgba(255, 255, 255, 0.25);
    color: rgb(var(--v-theme-on-primary));
  }
}

/* ══════════════════ Product grid ══════════════════ */
.products__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: var(--pos-space-2);
  padding: var(--pos-space-3);
  overflow-y: auto;
  align-content: start;
  min-height: 0;
  scrollbar-gutter: stable;
}

.products__empty {
  grid-column: 1 / -1;
  padding: 48px 16px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.product {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--pos-space-1);
  padding: var(--pos-space-3);
  min-height: 104px;
  background: var(--pos-surface-soft);
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-md);
  cursor: pointer;
  text-align: right;
  font-family: inherit;
  color: inherit;
  transition:
    transform 0.08s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
  content-visibility: auto;
  contain-intrinsic-size: 104px;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: var(--pos-primary);
    background: var(--pos-primary-soft);
    box-shadow: 0 4px 14px rgba(var(--v-theme-primary), 0.14);
  }
  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 2px;
    border-color: var(--pos-primary);
  }
  &:active:not(:disabled) {
    transform: translateY(0);
    background: var(--pos-primary-hover);
  }
  &--out,
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  &--skeleton {
    height: 104px;
    background: linear-gradient(
      90deg,
      var(--pos-surface-soft) 0%,
      var(--pos-surface-tint) 50%,
      var(--pos-surface-soft) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite ease-in-out;
    border: 1px solid var(--pos-border);
    pointer-events: none;
  }
  &--featured {
    background: linear-gradient(
      135deg,
      rgba(var(--v-theme-warning), 0.08),
      var(--pos-surface-soft) 70%
    );
    border-color: rgba(var(--v-theme-warning), 0.4);
    grid-column: span 2;
    min-height: 130px;
  }
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.product__badge {
  position: absolute;
  top: 8px;
  inset-inline-end: 8px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgb(var(--v-theme-warning));
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.product__name {
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;

  .product--featured & {
    font-size: 1rem;
  }
}

.product__cat {
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.product__foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.product__price {
  font-weight: 700;
  color: var(--pos-primary);
  font-variant-numeric: tabular-nums;
}

.product__stock {
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--pos-surface-tint);

  &.stock-ok {
    color: rgb(var(--v-theme-success));
  }
  &.stock-low {
    color: rgb(var(--v-theme-warning));
  }
  &.stock-out {
    color: rgb(var(--v-theme-error));
  }
}

/* ══════════════════ Cart header ══════════════════ */
.cart__handle {
  display: none;
  padding: var(--pos-space-2) 0;
  justify-content: center;
  cursor: pointer;

  .is-mobile & {
    display: flex;
  }
}

.cart__handle-bar {
  width: 40px;
  height: 4px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.25);
}

.cart__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--pos-border);
  flex-shrink: 0;
}

.cart__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.cart__title-icon {
  color: var(--pos-primary);
}

.cart__title-text {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.cart__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--pos-primary);
  color: rgb(var(--v-theme-on-primary));
  font-size: 0.72rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.cart__clear {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: rgb(var(--v-theme-error));
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(var(--v-theme-error), 0.1);
  }
}

/* ══════════════════ Cart lines ══════════════════ */
.cart__lines {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 6px 0;
}

.cart__empty {
  padding: 32px 16px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.cart__empty-icon-wrap {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: var(--pos-surface-tint);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.cart__empty-icon {
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.cart__empty-title {
  font-size: 1rem;
  font-weight: 700;
  margin-top: 4px;
}

.cart__empty-sub {
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.cart__hints {
  display: flex;
  gap: var(--pos-space-3);
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 16px;
}

.cart__hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.cart__hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 0.68rem;
  font-weight: 700;
  background: var(--pos-surface-tint);
  border: 1px solid var(--pos-border);
  border-bottom-width: 2px;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
}

.cart__lines-list {
  list-style: none;
  padding: 0 8px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Single line: name+meta on top, qty+total at bottom, X badge on edge ── */
.line {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  padding: 10px 12px 10px 36px; /* leave room for X */
  background: var(--pos-surface-soft);
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-md);
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    border-color: var(--pos-border);
    background: var(--pos-surface-tint);
  }

  &--flash {
    animation: line-flash 0.9s ease-out;
  }
}

@keyframes line-flash {
  0% {
    background: rgba(var(--v-theme-primary), 0.2);
    border-color: rgba(var(--v-theme-primary), 0.5);
  }
  60% {
    background: rgba(var(--v-theme-primary), 0.1);
  }
  100% {
    background: var(--pos-surface-soft);
  }
}

/* List transitions */
.line-anim-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.line-anim-enter-to {
  opacity: 1;
  transform: translateY(0);
}
.line-anim-enter-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.18s ease-out;
}
.line-anim-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  position: absolute;
  inset-inline: 0;
}
.line-anim-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
.line-anim-move {
  transition: transform 0.18s ease;
}

.line__remove {
  position: absolute;
  top: 6px;
  inset-inline-start: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: rgba(var(--v-theme-error), 0.12);
    color: rgb(var(--v-theme-error));
  }
}

.line__main {
  min-width: 0;
  cursor: pointer;
  border-radius: var(--pos-radius-sm);

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 2px;
  }
}

.line__name {
  font-weight: 700;
  font-size: 0.92rem;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.line__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.line__unit {
  font-weight: 600;
}
.line__sep {
  opacity: 0.4;
}
.line__unit-label {
  opacity: 0.7;
}

.line__chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 700;
  border: none;
  font-family: inherit;

  &--warning {
    background: rgba(var(--v-theme-warning), 0.14);
    color: rgb(var(--v-theme-warning));
  }
  &--note {
    background: var(--pos-surface-tint);
    color: rgba(var(--v-theme-on-surface), 0.7);
    max-width: 130px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.line__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pos-space-2);
  margin-top: 2px;
}

.line__qty {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--pos-surface);
  border: 1px solid var(--pos-border);
  padding: 2px;
}

.line__qty-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    color: var(--pos-primary);
  }
  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
  }
}

.line__qty-input {
  width: 38px;
  text-align: center;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  font-size: 0.9rem;

  &:focus-visible {
    outline: none;
  }
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
}

.line__total {
  font-weight: 800;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  color: var(--pos-primary);
}

/* ══════════════════ Cart total ══════════════════ */
.cart__total {
  padding: 10px 14px;
  border-top: 1px solid var(--pos-border);
  background: linear-gradient(180deg, transparent, var(--pos-surface-soft));
  flex-shrink: 0;
}

.cart__total-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--pos-border);
}

.cart__total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-variant-numeric: tabular-nums;
}

.cart__total-row-val {
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
}

.cart__total-row--warning .cart__total-row-val {
  color: rgb(var(--v-theme-warning));
}

.cart__total-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.cart__total-label {
  font-size: 0.92rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.cart__total-value {
  font-size: 1.7rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: var(--pos-primary);
  line-height: 1.1;
}

.cart__total-adv {
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  border-radius: 6px;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    color: var(--pos-primary);
  }
}

.cart__total-adv-hint {
  margin-inline-start: 6px;
  opacity: 0.85;
  font-weight: 600;
}

.cart__adjustments {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.adj__row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.adj__field {
  flex: 1 1 auto;
  min-width: 0;
}

.adj__seg {
  display: inline-flex;
  border: 1px solid var(--pos-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--pos-surface-soft);
  flex-shrink: 0;
}

.adj__seg-btn {
  border: none;
  background: transparent;
  padding: 6px 12px;
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7);

  &.active {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
  }
}

.adj__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;

  input {
    width: 16px;
    height: 16px;
    accent-color: var(--pos-primary);
  }
}

/* ══════════════════ Payment methods ══════════════════ */
.pay__methods {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--pos-space-2);
  padding: 8px 0px;
  flex-shrink: 0;
}

.pay__method {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px;
  min-height: 56px;
  border-radius: var(--pos-radius-md);
  border: 1px solid var(--pos-border);
  background: var(--pos-surface-soft);
  color: inherit;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    color: var(--pos-primary);
    border-color: rgba(var(--v-theme-primary), 0.25);
  }
  &.active {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
    border-color: var(--pos-primary);
  }
  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
  }
}

/* ══════════════════ Numpad ══════════════════ */
.numpad {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 4px;
  flex-shrink: 0;
}

.numpad__readout {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border-radius: var(--pos-radius-md);
  background: var(--pos-surface-tint);
  border: 1px solid var(--pos-border);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &.is-success {
    border-color: rgba(var(--v-theme-success), 0.4);
    background: rgba(var(--v-theme-success), 0.06);
  }
  &.is-error {
    border-color: rgba(var(--v-theme-error), 0.4);
    background: rgba(var(--v-theme-error), 0.06);
  }
  &.is-neutral {
    border-color: rgba(var(--v-theme-primary), 0.3);
  }
}

.numpad__readout-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.numpad__readout-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.numpad__readout-typed {
  font-size: 0.7rem;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
}

.numpad__readout-value {
  font-size: 1.5rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface));
  line-height: 1.15;
}

.numpad__delta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);

  .is-success & {
    color: rgb(var(--v-theme-success));
  }
  .is-error & {
    color: rgb(var(--v-theme-error));
  }
  .is-neutral & {
    color: var(--pos-primary);
  }
}

.numpad__delta-label {
  opacity: 0.85;
}
.numpad__delta-value {
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  margin-inline-start: auto;
}

.numpad__refs {
  margin-top: 2px;
}

.numpad__keys {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.numpad__key {
  height: 50px;
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-md);
  background: var(--pos-surface-soft);
  color: inherit;
  font: inherit;
  font-size: 1.15rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.12s ease,
    transform 0.08s ease,
    border-color 0.12s ease;
  user-select: none;
  touch-action: manipulation;

  &:hover {
    background: var(--pos-primary-soft);
    border-color: rgba(var(--v-theme-primary), 0.3);
  }
  &:active {
    transform: scale(0.96);
    background: var(--pos-primary-hover);
  }
  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
  }

  &--util {
    background: rgba(var(--v-theme-on-surface), 0.04);
    color: rgba(var(--v-theme-on-surface), 0.65);
  }
}

.numpad__actions-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 6px;
}

.numpad__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.numpad__util {
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-md);
  background: var(--pos-surface-soft);
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 800;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
  touch-action: manipulation;

  &:hover:not(:disabled) {
    background: var(--pos-primary-soft);
    border-color: rgba(var(--v-theme-primary), 0.3);
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  &--primary {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
    border-color: var(--pos-primary);

    &:hover:not(:disabled) {
      background: rgba(var(--v-theme-primary), 0.92);
      border-color: rgba(var(--v-theme-primary), 0.92);
    }
  }
}

.numpad__quick {
  display: flex;
  gap: 4px;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
  padding: 2px 0;

  &::-webkit-scrollbar {
    height: 4px;
  }
}

.numpad__quick-btn {
  flex: 1 1 60px;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px dashed var(--pos-border);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 0.78rem;
  font-weight: 800;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
  touch-action: manipulation;

  &:hover {
    background: var(--pos-primary-soft);
    border-color: rgba(var(--v-theme-primary), 0.4);
    border-style: solid;
    color: var(--pos-primary);
  }
}

/* ══════════════════ Hint ══════════════════ */
.pay__hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 4px 14px;
  flex-shrink: 0;
}

/* ══════════════════ Actions ══════════════════ */
.pay__actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: var(--pos-space-2);
  padding: 8px 12px 12px;
  flex-shrink: 0;
}

.pay__draft-btn {
  height: 52px !important;
  font-size: 0.88rem;
  font-weight: 700;
}

.pay__checkout {
  height: 52px !important;
  font-size: 1rem !important;
  font-weight: 900 !important;
  letter-spacing: 0.02em;
  position: relative;
}

.pay__hotkey {
  font-size: 0.68rem;
  opacity: 0.75;
  font-weight: 600;
  margin-inline-start: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.16);
}

/* ══════════════════ Line-edit dialog ══════════════════ */
.line-edit__title {
  padding-bottom: 0 !important;
}

.line-edit__name {
  font-size: 1rem;
  font-weight: 700;
}

.line-edit__body {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 12px;
  padding-top: 8px !important;
}

.line-edit__actions {
  padding: var(--pos-space-2) var(--pos-space-4) var(--pos-space-3);
}

/* ══════════════════ Cart header secondary actions ══════════════════ */
.cart__header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cart__drafts-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--pos-border);
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    border-color: var(--pos-primary);
  }
}

.cart__drafts-btn--disabled,
.cart__drafts-btn--disabled:hover {
  opacity: 0.55;
  cursor: not-allowed;
  background: transparent;
  border-color: var(--pos-border);
}

.cart__drafts-flag {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--pos-primary);
  color: rgb(var(--v-theme-on-primary));
  font-variant-numeric: tabular-nums;
}

/* ══════════════════ Drafts dialog ══════════════════ */
.drafts__title {
  padding: 12px 16px 4px !important;
}

.drafts__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  font-size: 1rem;
}

.drafts__body {
  padding: 4px 16px 12px !important;
  max-height: 60vh;
  overflow-y: auto;
}

.drafts__state {
  padding: 32px 8px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.drafts__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.drafts__item {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-md);
  background: var(--pos-surface);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &:hover {
    border-color: var(--pos-primary);
    background: var(--pos-primary-soft);
  }
}

.drafts__item-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.drafts__item-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.drafts__item-inv {
  font-weight: 800;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drafts__item-total {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--pos-primary);
  white-space: nowrap;
}

.drafts__item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.drafts__item-meta-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.drafts__item-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.drafts__actions {
  padding: 4px 12px 12px !important;
}

/* ══════════════════ Overlays ══════════════════ */
.pos__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 15;
}

/* ══════════════════ Responsive ══════════════════ */
@media (max-width: 1280px) {
  .pos {
    grid-template-columns: minmax(0, 1fr) 380px;
  }

  .products__grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }

  .numpad__key {
    height: 46px;
    font-size: 1.05rem;
  }
}

@media (max-width: 960px) {
  .pos {
    grid-template-columns: 1fr;
    height: auto;
    min-height: unset;
    gap: 0;
  }

  .pos__products {
    height: calc(100vh - 140px);
    min-height: 420px;
  }

  .products__grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
    padding: 10px;
  }

  .product--featured {
    grid-column: span 2;
  }

  .barcode-input {
    max-width: 140px;
  }

  /* Cart becomes a bottom sheet */
  .pos__cart {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-height: 92vh;
    height: auto;
    border-radius: var(--pos-radius-lg) var(--pos-radius-lg) 0 0;
    transform: translateY(100%);
    transition: transform 0.25s ease;
    z-index: 20;
    box-shadow: 0 -10px 32px rgba(0, 0, 0, 0.25);

    &.is-open {
      transform: translateY(0);
    }
  }

  .cart__lines {
    max-height: 28vh;
  }

  .pay__methods {
    gap: 6px;
    padding: 8px 10px;
  }

  .numpad {
    padding: 8px 10px 4px;
  }

  .numpad__key {
    height: 44px;
    font-size: 1rem;
  }

  .pay__actions {
    padding: 8px 10px 12px;
  }

  .pay__draft-btn,
  .pay__checkout {
    height: 48px !important;
    font-size: 0.92rem !important;
  }
}
</style>
