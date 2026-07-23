import { db } from '@infra/db/database';
import { createOrGetTag } from '@infra/db/transactions';
import { enqueueSearchUpsert } from '@app/search/search-index';
import { normalizeForComparison } from '@shared/utils/normalize';
import { nowIso } from '@shared/utils/date';
import { createError } from '@shared/protocol/envelope';

/**
 * TagService — tag management per PRD §11.4: create, rename, delete (without
 * deleting cards), merge, and list with card counts; plus bulk add/remove on
 * cards. Deleting a tag only removes the tag and its card associations, never
 * the cards themselves (§11.4).
 */

export interface TagView {
  id: string;
  name: string;
  cardCount: number;
}

export async function listTags(): Promise<TagView[]> {
  const tags = await db.tags.orderBy('normalizedName').toArray();
  return Promise.all(
    tags.map(async (tag) => {
      const cardCount = await db.cards.filter((c) => c.status !== 'deleted' && c.tagIds.includes(tag.id)).count();
      return { id: tag.id, name: tag.name, cardCount };
    }),
  );
}

export async function createTag(name: string): Promise<{ id: string; isNew: boolean }> {
  if (!name.trim()) throw createError('INVALID_INPUT', 'Tag name required', false);
  return createOrGetTag(name.trim());
}

export async function renameTag(tagId: string, newName: string): Promise<{ renamed: boolean }> {
  const tag = await db.tags.get(tagId);
  if (!tag) throw createError('NOT_FOUND', 'Tag not found', false);
  const normalizedName = normalizeForComparison(newName);
  const clash = await db.tags.get({ normalizedName });
  if (clash && clash.id !== tagId) {
    throw createError('CONFLICT', 'A tag with that name already exists', false);
  }
  await db.tags.update(tagId, { name: newName.trim(), normalizedName, revision: tag.revision + 1, updatedAt: nowIso() });
  return { renamed: true };
}

/**
 * Delete a tag. Removes the tag and its card associations, but NOT the cards
 * (§11.4). Affected cards are re-indexed for search.
 */
export async function deleteTag(tagId: string): Promise<{ deleted: boolean }> {
  const tag = await db.tags.get(tagId);
  if (!tag) throw createError('NOT_FOUND', 'Tag not found', false);
  const affected = await db.cards.filter((c) => c.tagIds.includes(tagId)).toArray();
  for (const card of affected) {
    await db.cards.update(card.id, {
      tagIds: card.tagIds.filter((t) => t !== tagId),
      updatedAt: nowIso(),
      revision: card.revision + 1,
    });
  }
  await db.cardTags.where('tagId').equals(tagId).delete();
  await db.tags.delete(tagId);
  for (const card of affected) await enqueueSearchUpsert(card.id);
  return { deleted: true };
}

/**
 * Merge sourceTagId into targetTagId: re-point all cards, then delete the
 * source tag. Cards are preserved (§11.4).
 */
export async function mergeTags(sourceTagId: string, targetTagId: string): Promise<{ merged: boolean }> {
  if (sourceTagId === targetTagId) throw createError('INVALID_INPUT', 'Cannot merge a tag into itself', false);
  const [source, target] = await Promise.all([db.tags.get(sourceTagId), db.tags.get(targetTagId)]);
  if (!source || !target) throw createError('NOT_FOUND', 'Tag not found', false);
  const affected = await db.cards.filter((c) => c.tagIds.includes(sourceTagId)).toArray();
  for (const card of affected) {
    const tagIds = card.tagIds.filter((t) => t !== sourceTagId);
    if (!tagIds.includes(targetTagId)) tagIds.push(targetTagId);
    await db.cards.update(card.id, { tagIds, updatedAt: nowIso(), revision: card.revision + 1 });
  }
  await db.cardTags.where('tagId').equals(sourceTagId).delete();
  await db.tags.delete(sourceTagId);
  for (const card of affected) await enqueueSearchUpsert(card.id);
  return { merged: true };
}

/**
 * Bulk add/remove a tag on a set of cards (§11.4 bulk).
 */
export async function bulkModifyTag(
  cardIds: string[],
  tagId: string,
  action: 'add' | 'remove',
): Promise<{ modified: number }> {
  const tag = await db.tags.get(tagId);
  if (!tag) throw createError('NOT_FOUND', 'Tag not found', false);
  let modified = 0;
  for (const cardId of cardIds) {
    const card = await db.cards.get(cardId);
    if (!card) continue;
    const has = card.tagIds.includes(tagId);
    if (action === 'add' && !has) {
      await db.cards.update(cardId, { tagIds: [...card.tagIds, tagId], updatedAt: nowIso(), revision: card.revision + 1 });
      modified++;
    } else if (action === 'remove' && has) {
      await db.cards.update(cardId, { tagIds: card.tagIds.filter((t) => t !== tagId), updatedAt: nowIso(), revision: card.revision + 1 });
      modified++;
    }
    if (action === 'add' || action === 'remove') await enqueueSearchUpsert(cardId);
  }
  return { modified };
}
