"""The application the committee flow reads: the shape of an `applications/{id}` document in al-core/SCHEMA.md.

The runner takes a JSON file in this shape and the submit trigger will pass the real document, so the flow never needs
a second mapping. Only the fields the committee uses are read; a real document carries many more and they are ignored.
The names are camelCase as in Firestore; the model gives them snake_case names for the rest of the code.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.valuation_endpoint import ValuationRequest


class Property(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    eircode: str
    county: str
    property_type: str = Field(alias="propertyType")
    bedrooms: int
    floor_area_m2: float = Field(alias="floorAreaSqm")
    ber: str = Field(alias="berRating")
    asking_price_eur: float | None = Field(default=None, alias="askingPriceEur")


class Application(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    loan_type: Literal["mortgage", "heloc"] = Field(alias="loanType")
    gross_income_eur: float = Field(alias="grossIncomeEur", gt=0)
    monthly_debts_eur: float = Field(alias="monthlyDebtsEur", ge=0)
    monthly_take_home_eur: float = Field(alias="monthlyTakeHomeEur", gt=0)
    monthly_living_costs_eur: float = Field(alias="monthlyLivingCostsEur", ge=0)
    term_years: int = Field(alias="termYears", ge=5, le=35)
    loan_amount_eur: float = Field(alias="loanAmountEur", gt=0)  # a HELOC's requested credit limit
    first_time_buyer: bool | None = Field(default=None, alias="firstTimeBuyer")
    existing_mortgage_balance_eur: float | None = Field(default=None, alias="existingMortgageBalanceEur", ge=0)
    broker_id: str | None = Field(default=None, alias="brokerId")  # the assigned broker; the committee flow refuses an application without one
    property: Property

    @model_validator(mode="after")
    def _fields_for_the_loan_type(self):
        """The same split as SCHEMA.md: a mortgage has an asking price and a first-time-buyer flag, a HELOC an existing balance."""
        if self.loan_type == "heloc":
            if self.existing_mortgage_balance_eur is None:
                raise ValueError("a HELOC needs existingMortgageBalanceEur")
            if self.property.asking_price_eur is not None:
                raise ValueError("a HELOC has no asking price")
        else:
            if self.property.asking_price_eur is None or self.property.asking_price_eur <= 0:
                raise ValueError("a mortgage needs property.askingPriceEur")
            if self.first_time_buyer is None:
                raise ValueError("a mortgage needs firstTimeBuyer")
            if self.existing_mortgage_balance_eur is not None:
                raise ValueError("existingMortgageBalanceEur is for a HELOC only")
        return self

    def valuation_request(self, run_id: str | None = None) -> ValuationRequest:
        """What the valuation model is asked. Raises pydantic's ValidationError for a county, type or BER the model does not know."""
        heloc = self.loan_type == "heloc"
        return ValuationRequest(
            county=self.property.county, property_type=self.property.property_type, bedrooms=self.property.bedrooms,
            floor_area_m2=self.property.floor_area_m2, ber=self.property.ber, eircode=self.property.eircode,
            asking_price_eur=self.property.asking_price_eur, run_id=run_id, loan_type=self.loan_type,
            existing_mortgage_balance_eur=self.existing_mortgage_balance_eur if heloc else None,
            loan_amount_eur=self.loan_amount_eur if heloc else None,
        )


def problems(error: ValidationError) -> str:
    """Which fields are wrong and why, with none of the values: an Eircode or an income must not end up in a run record."""
    parts = []
    for item in error.errors():
        where = ".".join(str(part) for part in item["loc"]) or "application"
        parts.append(f"{where}: {item['msg']}")
    return "; ".join(parts)
