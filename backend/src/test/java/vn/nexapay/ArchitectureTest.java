package vn.nexapay;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.*;

@AnalyzeClasses(packages = "vn.nexapay", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {
  @ArchTest
  static final com.tngtech.archunit.lang.ArchRule noCycles =
      slices().matching("vn.nexapay.(*)..").should().beFreeOfCycles();

  @ArchTest
  static final com.tngtech.archunit.lang.ArchRule controllersDoNotUseRepositories =
      noClasses()
          .that()
          .haveSimpleNameEndingWith("Controller")
          .should()
          .dependOnClassesThat(
              com.tngtech.archunit.base.DescribedPredicate
                  .<com.tngtech.archunit.core.domain.JavaClass>describe(
                      "project repositories",
                      c ->
                          c.getPackageName().startsWith("vn.nexapay.")
                              && c.getSimpleName().endsWith("Repository")));

  @ArchTest
  static final com.tngtech.archunit.lang.ArchRule internalRepositories =
      noClasses()
          .that()
          .resideOutsideOfPackage("..ledger..")
          .should()
          .dependOnClassesThat()
          .haveFullyQualifiedName("vn.nexapay.ledger.LedgerAccountRepository");
}
