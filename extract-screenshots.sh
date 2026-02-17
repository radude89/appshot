#!/bin/bash

# Screenshot Extraction Script
# Extracts raw PNG screenshots from XCUITest .xcresult bundles
#
# Usage:
#   ./extract-screenshots.sh --xcresult-path /path/to/test.xcresult
#   ./extract-screenshots.sh --help
#
# The script:
#   1. Accepts --xcresult-path argument pointing to an .xcresult bundle
#   2. Uses xcrun xcresulttool to list and extract PNG attachments
#   3. Organizes screenshots into: raw/{locale}/{screenshot-id}.png
#   4. Maps screenshot numbers to config IDs:
#      02 = vehicle-list
#      04 = vehicle-details
#      06 = event-list
#      07 = expense-list
#      08 = expense-chart
#      09 = fuel-calculator
#   5. Supports locales: en, fr, de, es, it, ro
#
# Example:
#   ./extract-screenshots.sh --xcresult-path ~/Library/Developer/Xcode/DerivedData/MyAutomobile-xxx/Logs/Test/Test-2025-02-16_10-30-45.xcresult

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to map screenshot number to config ID
get_config_id() {
    local number=$1
    case "$number" in
        02) echo "vehicle-list" ;;
        04) echo "vehicle-details" ;;
        06) echo "event-list" ;;
        07) echo "expense-list" ;;
        08) echo "expense-chart" ;;
        09) echo "fuel-calculator" ;;
        *) echo "" ;;
    esac
}

# Supported locales
SUPPORTED_LOCALES=("en" "fr" "de" "es" "it" "ro")

# Function to print usage
print_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --xcresult-path PATH    Path to the .xcresult bundle (required)
  --help                  Show this help message

Description:
  Extracts PNG screenshots from XCUITest .xcresult bundles and organizes them
  by locale and screenshot ID. Screenshots are extracted from attachments named
  in the format: {locale}-{number} (e.g., en-02, fr-04, de-08)

  Extracted screenshots are saved to: raw/{locale}/{screenshot-id}.png

Example:
  $(basename "$0") --xcresult-path ~/Library/Developer/Xcode/DerivedData/MyAutomobile-xxx/Logs/Test/Test-2025-02-16_10-30-45.xcresult

EOF
}

# Function to print error and exit
error_exit() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

# Function to print success message
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print info message
print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Parse command line arguments
XCRESULT_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --xcresult-path)
            XCRESULT_PATH="$2"
            shift 2
            ;;
        --help)
            print_usage
            exit 0
            ;;
        *)
            error_exit "Unknown option: $1"
            ;;
    esac
done

# Validate arguments
if [[ -z "$XCRESULT_PATH" ]]; then
    error_exit "Missing required argument: --xcresult-path"
fi

# Check if .xcresult exists
if [[ ! -d "$XCRESULT_PATH" ]]; then
    error_exit "xcresult file not found: $XCRESULT_PATH"
fi

# Check if xcrun is available
if ! command -v xcrun &> /dev/null; then
    error_exit "xcrun not found. Make sure Xcode is installed."
fi

# Create raw directory structure
RAW_DIR="$(dirname "$0")/raw"
mkdir -p "$RAW_DIR"

print_info "Extracting screenshots from: $XCRESULT_PATH"

# Get the list of attachments from the xcresult
# xcresulttool export --path <xcresult> --output-path <output> --type directory
TEMP_EXPORT_DIR=$(mktemp -d)
trap "rm -rf $TEMP_EXPORT_DIR" EXIT

# Export the xcresult to a temporary directory
xcrun xcresulttool export --path "$XCRESULT_PATH" --output-path "$TEMP_EXPORT_DIR" --type directory 2>/dev/null || \
    error_exit "Failed to export xcresult. Make sure the path is valid and the file is a valid .xcresult bundle."

# Find all PNG files in the exported directory
# They should be in: $TEMP_EXPORT_DIR/attachments/
ATTACHMENTS_DIR="$TEMP_EXPORT_DIR/attachments"

if [[ ! -d "$ATTACHMENTS_DIR" ]]; then
    error_exit "No attachments found in xcresult bundle. Make sure the test run captured screenshots."
fi

# Process each PNG file
EXTRACTED_COUNT=0
SKIPPED_COUNT=0

for png_file in "$ATTACHMENTS_DIR"/*.png; do
    if [[ ! -f "$png_file" ]]; then
        continue
    fi
    
    # Get the filename without extension
    filename=$(basename "$png_file" .png)
    
    # Parse filename format: {locale}-{number}
    # Example: en-02, fr-04, de-08
    if [[ $filename =~ ^([a-z]{2})-([0-9]{2})$ ]]; then
        locale="${BASH_REMATCH[1]}"
        number="${BASH_REMATCH[2]}"
        
        # Check if locale is supported
        if [[ ! " ${SUPPORTED_LOCALES[@]} " =~ " ${locale} " ]]; then
            print_info "Skipping unsupported locale: $filename"
            ((SKIPPED_COUNT++))
            continue
        fi
        
        # Get the config ID from the mapping
        config_id=$(get_config_id "$number")
        
        if [[ -z "$config_id" ]]; then
            print_info "Skipping unmapped screenshot number: $filename"
            ((SKIPPED_COUNT++))
            continue
        fi
        
        # Create locale directory
        locale_dir="$RAW_DIR/$locale"
        mkdir -p "$locale_dir"
        
        # Copy the PNG with the config ID as filename
        output_file="$locale_dir/$config_id.png"
        cp "$png_file" "$output_file"
        
        print_success "Extracted: $filename → $locale/$config_id.png"
        ((EXTRACTED_COUNT++))
    else
        print_info "Skipping file with unexpected format: $filename"
        ((SKIPPED_COUNT++))
    fi
done

# Print summary
echo ""
print_info "Extraction complete:"
print_success "Extracted: $EXTRACTED_COUNT screenshots"
if [[ $SKIPPED_COUNT -gt 0 ]]; then
    print_info "Skipped: $SKIPPED_COUNT files"
fi

# Verify extraction
if [[ $EXTRACTED_COUNT -eq 0 ]]; then
    error_exit "No screenshots were extracted. Check the xcresult file and screenshot naming."
fi

print_success "Screenshots saved to: $RAW_DIR"
exit 0