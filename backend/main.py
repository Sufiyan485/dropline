import pandas as pd
import joblib
from pathlib import Path
from xgboost import XGBClassifier
from fastapi import FastAPI
from pydantic import BaseModel, Field, model_validator
from typing import Literal
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

BASE_DIR = Path(__file__).parent

df = pd.read_csv(BASE_DIR / "telecom_churn_cleaned.csv")

ml_model = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    ml_model["preprocessor"] = joblib.load(BASE_DIR / "preprocessor.pkl")
    clf = XGBClassifier()
    clf.load_model(BASE_DIR / "xgb_model.json")
    ml_model["clf"] = clf
   
    yield
   
    ml_model.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

class ChurnRequest(BaseModel):
    gender             : Literal["Male", "Female"] = Field(..., description="Gender of the customer")
    senior_citizen     : Literal[0, 1] = Field(..., description="Whether the customer is a senior citizen (1) or not (0)")
    partner            : Literal["Yes", "No"] = Field(..., description="Whether the customer has a partner (Yes or No)")
    dependents         : Literal["Yes", "No"] = Field(..., description="Whether the customer has dependents (Yes or No)")
    tenure             : int = Field(..., ge=0,description="Number of months the customer has been with the company")
    phone_service      : Literal["Yes", "No"] = Field(..., description="Whether the customer has phone service (Yes or No)")
    multiple_lines     : Literal["Yes", "No", "No phone service"] = Field(..., description="Whether the customer has multiple lines (Yes, No, or No phone service)")
    internet_service   : Literal["DSL", "Fiber optic", "No"] = Field(..., description="Type of internet service (DSL, Fiber optic, or No)")
    online_security    : Literal["Yes", "No", "No internet service"] = Field(..., description="Whether the customer has online security (Yes, No, or No internet service)")
    online_backup      : Literal["Yes", "No", "No internet service"] = Field(..., description="Whether the customer has online backup (Yes, No, or No internet service)")
    device_protection  : Literal["Yes", "No", "No internet service"] = Field(..., description="Whether the customer has device protection (Yes, No, or No internet service)")
    tech_support       : Literal["Yes", "No", "No internet service"] = Field(..., description="Whether the customer has tech support (Yes, No, or No internet service)")
    streaming_tv       : Literal["Yes", "No", "No internet service"] = Field(..., description="Whether the customer has streaming TV (Yes, No, or No internet service)")
    streaming_movies   : Literal["Yes", "No", "No internet service"] = Field(..., description="Whether the customer has streaming movies (Yes, No, or No internet service)")
    contract           : Literal["Month-to-month", "One year", "Two year"] = Field(..., description="Type of contract (Month-to-month, One year, or Two year)")
    paperless_billing  : Literal["Yes", "No"] = Field(..., description="Whether the customer has paperless billing (Yes or No)")
    payment_method     : Literal["Electronic check", "Mailed check", "Bank transfer (automatic)", "Credit card (automatic)"] = Field(..., description="Payment method used by the customer")
    monthly_charges    : float = Field(..., ge=0, description="Monthly charges for the customer")
    total_charges      : float = Field(..., ge=0, description="Total charges for the customer")

    @model_validator(mode="after")
    def validate_service_dependencies(self):

        # Phone service dependency
        if self.phone_service == "No":
            if self.multiple_lines != "No phone service":
                raise ValueError(
                    "MultipleLines must be 'No phone service' when PhoneService is 'No'."
                )

        else:
            if self.multiple_lines == "No phone service":
                raise ValueError(
                    "MultipleLines cannot be 'No phone service' when PhoneService is 'Yes'."
                )


        # Internet service dependencies
        internet_services = [
            self.online_security,
            self.online_backup,
            self.device_protection,
            self.tech_support,
            self.streaming_tv,
            self.streaming_movies
        ]

        if self.internet_service == "No":

            if any(service != "No internet service" for service in internet_services):
                raise ValueError(
                    "All internet-related services must be 'No internet service' "
                    "when InternetService is 'No'."
                )

        else:

            if any(service == "No internet service" for service in internet_services):
                raise ValueError(
                    "Internet-related services must be 'Yes' or 'No' "
                    "when InternetService is DSL or Fiber optic."
                )

        return self

class PredictionResponse(BaseModel):
    churn_prediction: int
    churn_result: Literal["Churn", "No Churn"]
    churn_probability: float 

@app.get("/")
def greeting():
    return {"message": "Welcome to the Churn Prediction API!"}

@app.post("/predict", response_model=PredictionResponse)
def predict_churn(request: ChurnRequest):

    input_data = pd.DataFrame({
        "gender"             : [request.gender],
        "SeniorCitizen"      : [request.senior_citizen],
        "Partner"            : [request.partner],
        "Dependents"         : [request.dependents],
        "tenure"             : [request.tenure],
        "PhoneService"       : [request.phone_service],
        "MultipleLines"      : [request.multiple_lines],
        "InternetService"    : [request.internet_service],
        "OnlineSecurity"     : [request.online_security],
        "OnlineBackup"       : [request.online_backup],
        "DeviceProtection"   : [request.device_protection],
        "TechSupport"        : [request.tech_support],
        "StreamingTV"        : [request.streaming_tv],
        "StreamingMovies"    : [request.streaming_movies],
        "Contract"           : [request.contract],
        "PaperlessBilling"   : [request.paperless_billing],
        "PaymentMethod"      : [request.payment_method],
        "MonthlyCharges"     : [request.monthly_charges],
        "TotalCharges"       : [request.total_charges]
    })

    processed_data = ml_model["preprocessor"].transform(input_data)

    prediction = ml_model["clf"].predict(processed_data)[0]
    probability = ml_model["clf"].predict_proba(processed_data)[0][1]

    return PredictionResponse(
        churn_prediction=int(prediction),
        churn_result="Churn" if prediction == 1 else "No Churn",
        churn_probability=float(probability)
    )

@app.get("/insights")
def get_insights():

    # KPI calculations
    total_customers = int(len(df))

    churned_customers = int(
        (df["Churn"] == "Yes").sum()
    )

    churn_rate = (
        churned_customers / total_customers
    ) * 100

    # Churn by Contract
    churn_by_contract = pd.crosstab(
        df["Contract"],
        df["Churn"],
        normalize="index"
    ) * 100

    contract_churn_rate = {
    contract: round(float(rate), 2)
    for contract, rate in churn_by_contract["Yes"].items()
    }

    # Churn by Tenure
    bins = [0, 12, 24, 36, 48, 60, 72]

    labels = [
        "0-12 months",
        "13-24 months",
        "25-36 months",
        "37-48 months",
        "49-60 months",
        "61-72 months"
    ]

    tenure_group = pd.cut(
        df["tenure"],
        bins=bins,
        labels=labels,
        include_lowest=True
    )

    churn_by_tenure = pd.crosstab(
        tenure_group,
        df["Churn"],
        normalize="index"
    ) * 100

    tenure_churn_rate = {
        tenure: round(float(rate), 2)
        for tenure, rate in churn_by_tenure["Yes"].items()
    }

    # Churn by Monthly Charges
    bins = [18, 40, 60, 80, 100, 120]

    labels = [
        "18-40",
        "40-60",
        "60-80",
        "80-100",
        "100-120"
    ]

    monthly_charge_group = pd.cut(
        df["MonthlyCharges"],
        bins=bins,
        labels=labels,
        include_lowest=True
    )

    churn_by_monthly_charge = pd.crosstab(
        monthly_charge_group,
        df["Churn"],
        normalize="index"
    ) * 100

    monthly_charge_churn_rate = {
        charge_range: round(float(rate), 2)
        for charge_range, rate in churn_by_monthly_charge["Yes"].items()
    }

    # Churn by Internet Service
    churn_by_internet = pd.crosstab(
        df["InternetService"],
        df["Churn"],
        normalize="index"
    ) * 100

    internet_churn_rate = {
        service: round(float(rate), 2)
        for service, rate in churn_by_internet["Yes"].items()
    }

    # Churn by Payment Method
    churn_by_payment = pd.crosstab(
        df["PaymentMethod"],
        df["Churn"],
        normalize="index"
    ) * 100

    payment_churn_rate = {
        method: round(float(rate), 2)
        for method, rate in churn_by_payment["Yes"].items()
    }

    return {
        "total_customers": total_customers,
        "churned_customers": churned_customers,
        "churn_rate": round(churn_rate, 2),
        "churn_by_contract": contract_churn_rate,
        "churn_by_tenure": tenure_churn_rate,
        "churn_by_monthly_charges": monthly_charge_churn_rate,
        "churn_by_internet_service": internet_churn_rate,
        "churn_by_payment_method": payment_churn_rate
    }

@app.get("/model-insights")
def get_model_insights():
    confusion_matrix = {
    "true_negative": 741,
    "false_positive": 294,
    "false_negative": 71,
    "true_positive": 303
    }

    feature_names = ml_model["preprocessor"].get_feature_names_out()
    importances = ml_model["clf"].feature_importances_

    feature_importance = pd.DataFrame({
        "feature": feature_names,
        "importance": importances
    })

    feature_importance = feature_importance.sort_values(
        "importance",
        ascending=False
    ).head(10)

    feature_importance = [
        {
            "feature": row["feature"],
            "importance": round(float(row["importance"]), 6)
        }
        for _, row in feature_importance.iterrows()
    ]
    return {
        "accuracy": 0.74095,
        "precision": 0.51,
        "recall": 0.81,
        "f1_score": 0.62,
        "roc_auc": 0.84632,
        "confusion_matrix": confusion_matrix,
        "feature_importance": feature_importance
    }