# GitHub Bootstrap

Recommended new repository name:

`Vendify`

Recommended visibility while commercial/security work is active:

`Private`

After creating an empty GitHub repository:

```bash
git remote add origin https://github.com/<OWNER>/Vendify.git
git push -u origin main
git push -u origin develop
git push origin --tags
```

The local history already contains:

1. frozen production baseline commit;
2. engineering foundation commit;
3. immutable `v2.31.1-production-baseline` tag.

After the first `npm install`, commit the generated `package-lock.json` before feature development.
