# Family Recipe Box

The family's recipe cards as a website. Each recipe is drawn as a left-to-right method table, with the original scanned card one tap away. It has no build step and no dependencies, so it runs on GitHub Pages as is.

**What the site does**
- Search and category filters, favourites, a list view, and print.
- **Scaling**: change the servings or batch size and every quantity is recalculated.
- **Units**: "As written + metric", "Cups & spoons", or "Grams & mL". Cups ↔ grams uses an ingredient density table, so flour, sugar, butter and so on convert correctly.
- **Changing the pan?** box on baked recipes: pick a different pan size, shape or material. It works out how many pans or muffin cups you need, how deep the batter will be, and the adjusted time and temperature.
- **Kitchen tools** page: a measure converter, an oven-temperature table, a stand-alone bake-time estimator and a pan-size chart.
- **Add recipe**: a form with a live table preview. Recipes can be saved on the device, shared as a link, or submitted to the shared cookbook.

## Adding recipes from websites

- **On a computer:** open *Settings & sharing* on your site and drag the **+ Add to Recipe Box** button to your browser's bookmarks bar. On any recipe page, click that bookmark: the recipe opens in your Recipe Box with everything filled in (name, servings, ingredients, steps, oven temperature, time and pan size), ready to check and save. It reads the recipe data that most recipe sites include (Allrecipes, Food Network, Canadian Living, NYT Cooking, most blogs). If a site has none, select the recipe text first and click the bookmark again.
- **On a phone:** open *+ Add recipe*, tap **Copying a recipe from a website?**, paste the copied recipe and press **Fill in the form**.

In both cases each step is linked to the ingredients it mentions, so the table builds itself. Tap the chips to move anything that landed in the wrong step. "Preheat" and "grease the pan" steps go to *Before you start*.

## Put it on GitHub Pages (about 5 minutes)

1. Create a new repository on GitHub (for example `recipes`) and upload everything in this folder, including the hidden `.github` folder and the `.nojekyll` file.
2. Edit `config.js` and set `repo` to `"your-github-name/recipes"`.
3. In the repository, go to **Settings → Pages**, set **Source: Deploy from a branch**, choose **Branch: main / (root)**, and save. The site appears at `https://your-github-name.github.io/recipes/` after a minute or two.
4. In **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**.
5. In **Issues → Labels**, create a label named `approved`.

## How shared recipes work

- Someone adds a recipe and presses **Submit to family cookbook**. A GitHub issue opens with the recipe already filled in, and they press *Create*. A free GitHub account is needed for this.
- You add the **approved** label to the issue. A GitHub Action then adds the recipe to `data/community.json`, commits it and closes the issue, and the recipe appears for everyone. Fixes to existing recipes ("Suggest a fix") work the same way and replace the original.
- **Editors** can skip the issue step: under *Settings & sharing* on the site, paste a GitHub fine-grained token with *Contents: read & write* on this repository only. A **Publish now** button then appears on the add-recipe form.
- **Share link** works without GitHub at all. The whole recipe is packed into the link, and whoever opens it can save it to their own device.

## Editing recipes

The transcribed cards are in `src/recipes/*.txt`, in a simple format that is explained at the top of `tools/build.py`:

```
=== Bran Muffins (Mom)
cat: Breads & Muffins
serves: 12 muffins
bake: 400F 15-20 muffin*12
- 3/4 cup brown sugar        ← ingredients are numbered 1, 2, 3…
- 1 egg
* mix well | 1-2             ← a step and the ingredients it uses
> spoon into pans            ← continues from the step above
> {bake}                     ← fills in the oven temp and time
```

When you push a change to these files, GitHub runs `python3 tools/build.py` and regenerates `data/recipes.json`. You can also run it yourself. The build stops with a clear message if a step refers to something that doesn't exist or an ingredient is never used.

## Notes on the transcription

- There are 450 recipes from 456 recipe scans. Several cards hold more than one recipe, and multi-page cards are joined into one recipe. Every scan is attached to a recipe.
- Where a card is cut off or missing a page (for example Applesauce Cake, Banana Loaf, Cranberry Coffee Cake, Coffee Almond Dacquoise and Peach Bavarian), the recipe page says so in a note. Check those against the original.
- Seven "Dance" photos in the zip weren't recipes, so they were left out.
- `Almond Lemon Rice Pilaf.cpt` is a Corel Photo-Paint file that couldn't be opened. Export it as a JPG and add it with the + Add recipe form.
- The strawberry shortcake Word document is included as *Great Granny's Magnificent Strawberry Shortcake*.
