NAME = blur-my-shell
UUID = $(NAME)@eturkes.com
GETTEXT_DOMAIN = $(NAME)@aunetx
GJS ?= /usr/bin/gjs
GNOME_EXTENSIONS ?= /usr/bin/gnome-extensions
GLIB_COMPILE_SCHEMAS ?= /usr/bin/glib-compile-schemas
VM_PATH = ~/Projects/shared/extensions
POT = po/$(GETTEXT_DOMAIN).pot
UI_SOURCES = $(shell find resources/ui -type f -name '*.ui' | sort)
EFFECT_I18N_SOURCES = $(shell find src/effects -type f -name '*.js' | sort)
PREFERENCES_I18N_SOURCES = $(shell find src/preferences -type f -name '*.js' | sort) src/prefs.js
SOURCE_DIRS = $(filter-out styles,$(patsubst src/%/,%,$(wildcard src/*/)))
# Preserve cascade order when bundling the component stylesheets.
STYLESHEETS = src/styles/panel.css \
	src/styles/dash.css \
	src/styles/popup/base.css \
	src/styles/popup/transparent.css \
	src/styles/popup/light.css \
	src/styles/popup/dark.css \
	src/styles/popup/menu-items.css \
	src/styles/overview.css \
	src/styles/appfolders.css \
	src/styles/panel-light-text.css

.PHONY: build install check pot test-shell test-prefs test-vm remove clean


build: clean
	mkdir -p build/source
	cp -a src/. build/source/
	cp metadata.json LICENSE build/source/
	cp -a resources/icons resources/ui schemas build/source/
	$(GLIB_COMPILE_SCHEMAS) --strict build/source/schemas
# St does not give CSS @imports the priority of the extension stylesheet.
	awk '{ print }' $(STYLESHEETS) > build/source/stylesheet.css
	cd build/source && $(GNOME_EXTENSIONS) pack -f . \
			--extra-source=LICENSE \
			--extra-source=icons \
			--extra-source=ui \
			$(foreach dir,$(SOURCE_DIRS),--extra-source=./$(dir)) \
			--podir=../../po \
			--gettext-domain=$(GETTEXT_DOMAIN) \
			--schema=../../schemas/org.gnome.shell.extensions.$(NAME).gschema.xml \
			-o ..
	cd build/source && zip -q ../$(UUID).shell-extension.zip schemas/gschemas.compiled

# Installs the private UUID only; load updated modules with a fresh login.
install: build
	GNOME_EXTENSIONS=$(GNOME_EXTENSIONS) ./scripts/install-personal.sh build/$(UUID).shell-extension.zip

check: build
	./tests/run.sh --stylesheet build/source/stylesheet.css


pot:
	xgettext --language=JavaScript --from-code=utf-8 --package-name=$(GETTEXT_DOMAIN) \
		--keyword=_ --keyword=ngettext:1,2 \
		--output=$(POT) $(EFFECT_I18N_SOURCES)
	xgettext --language=Glade --from-code=utf-8 --package-name=$(GETTEXT_DOMAIN) \
		--join-existing --output=$(POT) $(UI_SOURCES)
	xgettext --language=JavaScript --from-code=utf-8 --package-name=$(GETTEXT_DOMAIN) \
		--keyword=_ --keyword=ngettext:1,2 --join-existing \
		--output=$(POT) $(PREFERENCES_I18N_SOURCES)
	find po -maxdepth 1 -type f -name '*.po' -printf '%f\n' | \
		sed 's/\.po$$//' | sort > po/LINGUAS
	for catalog in po/*.po; do \
		msgmerge --update --backup=none --no-fuzzy-matching "$$catalog" $(POT); \
	done


TEST_SHELL_MODE ?= auto
test-shell: build
	sh scripts/test-shell.sh "$(UUID)" "build/$(UUID).shell-extension.zip" "$(TEST_SHELL_MODE)"


test-prefs:
	$(GNOME_EXTENSIONS) prefs $(UUID)


test-vm: build
	unzip -oq build/$(UUID).shell-extension.zip -d $(VM_PATH)/$(UUID)


remove:
	$(GNOME_EXTENSIONS) uninstall $(UUID)


clean:
	rm -rf build/ po/*.mo schemas/gschemas.compiled
