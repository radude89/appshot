#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.json"

print_error() { echo -e "${RED}✗ Error: $1${NC}" >&2; }
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }
print_step() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Uploads generated screenshots to App Store Connect via fastlane deliver.

Options:
  --config <path>           Path to config file (default: config.json)
  --key-id <id>             App Store Connect API Key ID
  --issuer-id <id>          App Store Connect Issuer ID
  --key-path <path>         Path to .p8 API key file
  --app-id <bundle-id>      App bundle identifier
  --skip-staging            Skip screenshot staging (use existing staged files)
  --dry-run                 Stage screenshots but don't upload
  --help                    Show this help message

Environment variables (alternative to flags):
  ASC_KEY_ID                API Key ID
  ASC_ISSUER_ID             Issuer ID
  ASC_KEY_PATH              Path to .p8 file
  ASC_APP_ID                Bundle identifier

Config file (alternative to flags/env):
  Add an "upload" section to config.json — see config.example.json

EOF
}

ASC_KEY_ID_ARG=""
ASC_ISSUER_ID_ARG=""
ASC_KEY_PATH_ARG=""
ASC_APP_ID_ARG=""
SKIP_STAGING=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --config) CONFIG_FILE="$2"; shift 2 ;;
        --key-id) ASC_KEY_ID_ARG="$2"; shift 2 ;;
        --issuer-id) ASC_ISSUER_ID_ARG="$2"; shift 2 ;;
        --key-path) ASC_KEY_PATH_ARG="$2"; shift 2 ;;
        --app-id) ASC_APP_ID_ARG="$2"; shift 2 ;;
        --skip-staging) SKIP_STAGING=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --help) print_usage; exit 0 ;;
        *) print_error "Unknown option: $1"; print_usage; exit 1 ;;
    esac
done

resolve_config_value() {
    local cli_val="$1"
    local env_val="$2"
    local config_key="$3"

    if [[ -n "$cli_val" ]]; then
        echo "$cli_val"
    elif [[ -n "$env_val" ]]; then
        echo "$env_val"
    elif [[ -f "$CONFIG_FILE" ]]; then
        node -p "try{require('$CONFIG_FILE').upload.$config_key||''}catch(e){''}" 2>/dev/null || echo ""
    else
        echo ""
    fi
}

locale_to_asc() {
    case "$1" in
        en) echo "en-US" ;;
        de) echo "de-DE" ;;
        fr) echo "fr-FR" ;;
        es) echo "es-ES" ;;
        it) echo "it" ;;
        ro) echo "ro" ;;
        pt) echo "pt-BR" ;;
        ja) echo "ja" ;;
        ko) echo "ko" ;;
        zh) echo "zh-Hans" ;;
        nl) echo "nl-NL" ;;
        ru) echo "ru" ;;
        sv) echo "sv" ;;
        da) echo "da" ;;
        fi) echo "fi" ;;
        no) echo "no" ;;
        pl) echo "pl" ;;
        tr) echo "tr" ;;
        *) echo "$1" ;;
    esac
}

check_prereqs() {
    print_step "Pre-flight Checks"

    if ! command -v fastlane &> /dev/null; then
        print_error "fastlane not found. Install with: gem install fastlane"
        exit 1
    fi
    print_success "fastlane found: $(fastlane --version 2>/dev/null | head -1)"

    if ! command -v node &> /dev/null; then
        print_error "node not found (needed to read config)"
        exit 1
    fi
    print_success "node found"

    KEY_ID=$(resolve_config_value "$ASC_KEY_ID_ARG" "${ASC_KEY_ID:-}" "keyId")
    ISSUER_ID=$(resolve_config_value "$ASC_ISSUER_ID_ARG" "${ASC_ISSUER_ID:-}" "issuerId")
    KEY_PATH=$(resolve_config_value "$ASC_KEY_PATH_ARG" "${ASC_KEY_PATH:-}" "keyPath")
    APP_ID=$(resolve_config_value "$ASC_APP_ID_ARG" "${ASC_APP_ID:-}" "appId")

    if [[ -z "$KEY_ID" ]]; then print_error "Missing API Key ID (--key-id, ASC_KEY_ID, or config upload.keyId)"; exit 1; fi
    if [[ -z "$ISSUER_ID" ]]; then print_error "Missing Issuer ID (--issuer-id, ASC_ISSUER_ID, or config upload.issuerId)"; exit 1; fi
    if [[ -z "$APP_ID" ]]; then print_error "Missing App Bundle ID (--app-id, ASC_APP_ID, or config upload.appId)"; exit 1; fi

    if [[ -z "$KEY_PATH" ]]; then
        KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
    fi

    if [[ ! -f "$KEY_PATH" ]]; then
        print_error "API key file not found: $KEY_PATH"
        print_info "Download from App Store Connect → Users and Access → Integrations → Team API Keys"
        exit 1
    fi

    print_success "API Key ID: $KEY_ID"
    print_success "Issuer ID: $ISSUER_ID"
    print_success "Key file: $KEY_PATH"
    print_success "App ID: $APP_ID"
}

stage_screenshots() {
    if [[ "$SKIP_STAGING" == true ]]; then
        print_step "Stage Screenshots [SKIPPED]"
        return
    fi

    print_step "Stage Screenshots for Fastlane"

    local output_path
    output_path=$(node -p "require('$CONFIG_FILE').output.path" 2>/dev/null || echo "fastlane/screenshots")
    local source_dir="$SCRIPT_DIR/$output_path"
    local staging_dir="$SCRIPT_DIR/.upload-staging"

    if [[ ! -d "$source_dir" ]]; then
        print_error "Generated screenshots not found at: $source_dir"
        print_info "Run 'node generate.mjs' first to generate screenshots"
        exit 1
    fi

    rm -rf "$staging_dir"
    mkdir -p "$staging_dir"

    local total=0

    for locale_dir in "$source_dir"/*/; do
        [[ ! -d "$locale_dir" ]] && continue
        local locale=$(basename "$locale_dir")
        local asc_locale=$(locale_to_asc "$locale")

        mkdir -p "$staging_dir/$asc_locale"

        for device_dir in "$locale_dir"/*/; do
            [[ ! -d "$device_dir" ]] && continue
            local device_name=$(basename "$device_dir")

            for img in "$device_dir"/*.png; do
                [[ ! -f "$img" ]] && continue
                local screen_id=$(basename "$img" .png)
                local dest_name="${device_name}-${screen_id}.png"
                cp "$img" "$staging_dir/$asc_locale/$dest_name"
                ((total++))
            done
        done

        local count=$(find "$staging_dir/$asc_locale" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
        print_success "$locale → $asc_locale: $count screenshots"
    done

    print_success "Staged $total screenshots to $staging_dir"
}

upload_screenshots() {
    if [[ "$DRY_RUN" == true ]]; then
        print_step "Upload to App Store Connect [DRY RUN]"
        print_info "Screenshots staged but not uploaded (--dry-run)"
        print_info "Staged directory: $SCRIPT_DIR/.upload-staging"
        return
    fi

    print_step "Upload to App Store Connect"

    local staging_dir="$SCRIPT_DIR/.upload-staging"

    if [[ ! -d "$staging_dir" ]] || [[ -z "$(ls -A "$staging_dir" 2>/dev/null)" ]]; then
        print_error "No staged screenshots found. Run without --skip-staging first."
        exit 1
    fi

    local temp_fastlane_dir
    temp_fastlane_dir=$(mktemp -d)
    trap "rm -rf $temp_fastlane_dir" EXIT

    cat > "$temp_fastlane_dir/Appfile" << EOF
app_identifier "$APP_ID"
EOF

    cat > "$temp_fastlane_dir/Fastfile" << EOF
default_platform(:ios)

platform :ios do
  lane :upload_screenshots do
    api_key = app_store_connect_api_key(
      key_id: "$KEY_ID",
      issuer_id: "$ISSUER_ID",
      key_filepath: "$KEY_PATH"
    )

    upload_to_app_store(
      api_key: api_key,
      skip_binary_upload: true,
      skip_metadata: true,
      screenshots_path: "$staging_dir",
      overwrite_screenshots: true,
      submit_for_review: false,
      force: true,
      precheck_include_in_app_purchases: false
    )
  end
end
EOF

    print_info "Running fastlane deliver..."
    if (cd "$temp_fastlane_dir" && fastlane upload_screenshots); then
        print_success "Screenshots uploaded to App Store Connect"
    else
        print_error "Upload failed. Check fastlane output above."
        exit 1
    fi
}

print_summary() {
    print_step "Upload Summary"

    local staging_dir="$SCRIPT_DIR/.upload-staging"
    local total=0

    for locale_dir in "$staging_dir"/*/; do
        [[ ! -d "$locale_dir" ]] && continue
        local locale=$(basename "$locale_dir")
        local count=$(find "$locale_dir" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
        total=$((total + count))
        print_success "$locale: $count screenshots"
    done

    echo ""
    print_success "Total: $total screenshots uploaded"
}

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  appshot - Upload Screenshots to App Store Connect"
    echo "═══════════════════════════════════════════════════════════════"

    check_prereqs
    stage_screenshots
    upload_screenshots
    print_summary

    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "${GREEN}  🎉 Upload completed successfully!${NC}"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
}

main "$@"
