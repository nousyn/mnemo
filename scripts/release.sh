#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# Mnemo Release Script
# ─────────────────────────────────────────────

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# Step counter
STEP=0
TOTAL_STEPS=7

step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${BLUE}${BOLD}[$STEP/$TOTAL_STEPS]${RESET} ${BOLD}$1${RESET}"
    echo -e "${DIM}────────────────────────────────────────${RESET}"
}

success() {
    echo -e "  ${GREEN}✓${RESET} $1"
}

warn() {
    echo -e "  ${YELLOW}⚠${RESET} $1"
}

fail() {
    echo -e "  ${RED}✗${RESET} $1"
    exit 1
}

confirm() {
    echo ""
    read -r -p "  $1 [y/N] " answer
    case "$answer" in
        [yY][eE][sS]|[yY]) return 0 ;;
        *) echo ""; echo -e "  ${DIM}已取消${RESET}"; exit 0 ;;
    esac
}

# ─────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}Mnemo Release${RESET}"
echo -e "${DIM}────────────────────────────────────────${RESET}"

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "  当前版本: ${BOLD}v${CURRENT_VERSION}${RESET}"

# ─────────────────────────────────────────────
# Step 1: Check git status
# ─────────────────────────────────────────────
step "检查 Git 工作区"

if [ -n "$(git status --porcelain)" ]; then
    fail "工作区不干净，请先提交或暂存所有改动"
fi
success "工作区干净"

# ─────────────────────────────────────────────
# Step 2: Check branch
# ─────────────────────────────────────────────
step "检查分支"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "  当前分支: ${BOLD}${BRANCH}${RESET}"

if [ "$BRANCH" != "main" ]; then
    warn "当前不在 main 分支，正式发包建议在 main 分支进行"
    confirm "确定要从 ${BRANCH} 分支发包吗？"
fi
success "分支确认: ${BRANCH}"

# ─────────────────────────────────────────────
# Step 3: Select version bump
# ─────────────────────────────────────────────
step "选择版本号"

echo ""
echo "  请选择版本升级类型:"
echo ""

OPTIONS=("patch" "minor" "major" "prepatch" "preminor" "premajor")
DESCRIPTIONS=(
    "补丁版本 (bug fixes)"
    "次版本号 (new features)"
    "主版本号 (breaking changes)"
    "预发布补丁"
    "预发布次版本"
    "预发布主版本"
)

for i in "${!OPTIONS[@]}"; do
    # Preview what the version would be
    PREVIEW=$(npx --yes semver "$CURRENT_VERSION" -i "${OPTIONS[$i]}" 2>/dev/null || echo "?")
    echo -e "    ${BOLD}$((i + 1)))${RESET} ${OPTIONS[$i]}  ${DIM}→ v${PREVIEW}${RESET}  ${DIM}(${DESCRIPTIONS[$i]})${RESET}"
done

echo ""
while true; do
    read -r -p "  请输入选项 [1-${#OPTIONS[@]}]: " choice
    if [[ "$choice" =~ ^[1-6]$ ]]; then
        VERSION_TYPE="${OPTIONS[$((choice - 1))]}"
        break
    fi
    echo -e "  ${RED}无效选项，请重新输入${RESET}"
done

NEW_VERSION=$(npx --yes semver "$CURRENT_VERSION" -i "$VERSION_TYPE" 2>/dev/null)
echo ""
success "版本升级: v${CURRENT_VERSION} → v${NEW_VERSION} (${VERSION_TYPE})"

confirm "确认发布 v${NEW_VERSION}？"

# ─────────────────────────────────────────────
# Step 4: Format
# ─────────────────────────────────────────────
step "格式化代码"

npm run prettier:fix 2>&1 | tail -1
success "格式化完成"

# Check if formatting created changes
if [ -n "$(git status --porcelain)" ]; then
    fail "格式化产生了未提交的改动，请先提交后重新运行"
fi

# ─────────────────────────────────────────────
# Step 5: Test
# ─────────────────────────────────────────────
step "回归测试"

npm test 2>&1 | tail -3
success "测试通过"

# ─────────────────────────────────────────────
# Step 6: Build
# ─────────────────────────────────────────────
step "构建"

npm run build 2>&1
success "构建完成"

# ─────────────────────────────────────────────
# Step 7: Version + Publish + Push
# ─────────────────────────────────────────────
step "发布"

echo -e "  ${DIM}npm version ${VERSION_TYPE}...${RESET}"
npm version "$VERSION_TYPE" --no-git-tag-version > /dev/null 2>&1

# Commit and tag manually to control the message
NEW_VERSION=$(node -p "require('./package.json').version")
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "release: v${NEW_VERSION}" > /dev/null 2>&1
git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"
success "版本: v${NEW_VERSION}"

echo -e "  ${DIM}npm publish...${RESET}"
npm publish --access public
success "npm 发布完成"

echo -e "  ${DIM}git push...${RESET}"
git push && git push --tags
success "Git 推送完成"

# ─────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}发布成功！${RESET}"
echo -e "  版本: ${BOLD}v${NEW_VERSION}${RESET}"
echo -e "  分支: ${BRANCH}"
echo -e "  npm:  https://www.npmjs.com/package/mnemo"
echo ""
