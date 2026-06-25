# Publish to GitHub

Run once (login in browser when prompted):

```powershell
gh auth login
```

Then create the public repo and push:

```powershell
cd "D:\Hyper-V\Lab\tesserakt lab\barotrauma-sub-preview"
gh repo create barotrauma-sub-preview --public --source=. --remote=origin --push --description "Swap and composite preview images in Barotrauma .sub files"
```

If the repo name is taken, pick another name and update `README.md` clone URL.
